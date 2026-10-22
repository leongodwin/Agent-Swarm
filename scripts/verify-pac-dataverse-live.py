"""Authenticated read-only native evidence. Never imports or fabricates outcomes."""
import datetime, hashlib, json, pathlib, subprocess, time, uuid

REPO = pathlib.Path(__file__).resolve().parents[1]
TARGET = 'https://org68dad46d.crm4.dynamics.com'
EXPECTED_ORG = '276d6f5c-20f4-46de-a631-825a64953d21'
EXPECTED_USER = '5a89d846-73f1-eb11-94ee-000d3ab40fca'
ROOT = REPO / 'output' / ('pac-dataverse-live-' + uuid.uuid4().hex)
ROOT.mkdir()
NODE = subprocess.check_output(['where.exe', 'node.exe'], text=True).splitlines()[0]
results = []

def write(file, value):
    file.write_text(json.dumps(value, indent=2), encoding='utf-8')

def request(label, executable, args):
    root = ROOT / label
    root.mkdir()
    body = dict(root=str(root), runId=str(uuid.uuid4()), id=str(uuid.uuid4()), environmentUrl=TARGET,
                command=dict(executable=executable, args=args))
    file = root / 'request.json'
    write(file, body)
    process = subprocess.Popen([NODE, '--import', 'tsx', 'scripts/live-native-provider-probe.ts', str(file)],
                               cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return root, body, process

def probe(label, executable, args, failure=False):
    root, body, process = request(label, executable, args)
    try:
        out, err = process.communicate(timeout=90)
    except subprocess.TimeoutExpired:
        process.kill()  # Only the adapter process created immediately above.
        out, err = process.communicate(timeout=20)
        (root / 'adapter-stderr.txt').write_bytes(err)
        write(root / 'timeout.json', dict(ownedOwnerPid=process.pid, deliveryResumed=False,
                                        nativeTerminationRequiresProof=True))
        raise RuntimeError(label + ': owned adapter timed out; termination proof requires review')
    (root / 'adapter-stderr.txt').write_bytes(err)
    result = json.loads((root / (body['id'] + '.result.json')).read_text())
    response = (root / (body['id'] + '.response.txt')).read_text(encoding='utf-8')
    if (result['outcome'] != 'returned') != failure:
        raise RuntimeError(label + ': unexpected native result: ' + response[:1500])
    if not result['native']['nativeTreeQuiescenceVerified']:
        raise RuntimeError(label + ': no eligible native termination proof')
    results.append(dict(label=label, result=result, processExit=process.returncode))
    write(ROOT / 'progress.json', results)
    return response

def whoami(label):
    row = json.loads(probe(label, 'dataverse', ['api', 'request', '--target', 'dataverse', '--environment', TARGET,
                                            '--method', 'GET', '--path', '/api/data/v9.2/WhoAmI']))
    if row['OrganizationId'].lower() != EXPECTED_ORG or row['UserId'].lower() != EXPECTED_USER:
        raise RuntimeError('Authenticated target identity mismatch')
    return row

def descendants(pid):
    # Only owned descendants are emitted. Never enumerate credential/cache files.
    script = ('$all=Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate;'
              f'$ids=@({pid});$owned=@();for($level=0;$level -lt 7;$level++)'
              '{$next=@($all | Where-Object {$ids -contains $_.ParentProcessId});if(!$next.Count){break};'
              '$owned+=$next;$ids=@($next.ProcessId)};'
              '@($owned | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate) | ConvertTo-Json -Compress')
    data = subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], text=True)
    parsed = json.loads(data) if data.strip() else []
    return parsed if isinstance(parsed, list) else [parsed]

try:
    baseline = whoami('dataverse-baseline')
    inventory = json.loads(probe('pac-inventory', 'pac', ['solution', 'list', '--environment', TARGET, '--json']))
    if not isinstance(inventory, list):
        raise RuntimeError('PAC did not return actual authenticated solution inventory')
    missing = '/api/data/v9.2/cubefarm_missing_' + uuid.uuid4().hex
    error = probe('dataverse-provider-error', 'dataverse', ['api', 'request', '--target', 'dataverse',
                  '--environment', TARGET, '--method', 'GET', '--path', missing], failure=True)
    if '0x80060888' not in error:
        raise RuntimeError('Failure is not a genuine HTTP/provider rejection: ' + error[:1500])
    whoami('dataverse-after-error')
    root, body, process = request('pac-forced-owner-crash', 'pac', ['solution', 'list', '--environment', TARGET, '--json'])
    observed = []
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline and process.poll() is None:
            observed = descendants(process.pid)
            if any(item.get('Name', '').lower() == 'pac.launcher.exe' for item in observed):
                break
            time.sleep(.1)
        if not any(item.get('Name', '').lower() == 'pac.launcher.exe' for item in observed) or process.poll() is not None:
            raise RuntimeError('No in-flight PAC provider process observed; no crash claimed')
        write(root / 'owned-descendants-before-crash.json', observed)
        process.kill()  # Only the child created above; never a discovered PID.
        out, err = process.communicate(timeout=20)
        (root / 'adapter-stderr.txt').write_bytes(err)
        lease_bytes = (root / 'delivery.lock').read_bytes()
        lease = json.loads(lease_bytes)
        if lease['pid'] != process.pid:
            raise RuntimeError('Interrupted owner differs from the process we started')
        directory = root / 'delivery-native' / hashlib.sha256(lease_bytes).hexdigest()
        deadline = time.monotonic() + 30
        proofs = []
        while time.monotonic() < deadline:
            proofs = list(directory.glob('*.tree.json'))
            if proofs:
                break
            time.sleep(.1)
        if len(proofs) != 1:
            raise RuntimeError('Owned supervisor did not publish termination proof')
        proof = json.loads(proofs[0].read_text())
        intent_file = directory / (proof['id'] + '.intent.json')
        intent = json.loads(intent_file.read_text())
        command_bytes = json.dumps(body['command'], separators=(',', ':')).encode()
        if (proof['intentSha256'] != hashlib.sha256(intent_file.read_bytes()).hexdigest()
            or intent['commandSha256'] != hashlib.sha256(command_bytes).hexdigest()
            or intent['runId'] != body['runId'] or proof['activeProcesses'] != 0
            or not proof['nativeTreeQuiescenceVerified'] or proof['breakawayAllowed']):
            raise RuntimeError('Native proof attribution or zero-process check failed')
        results.append(dict(label='pac-forced-owner-crash', ownedOwnerPid=process.pid,
                            nativeProviderObserved=True, proof=proof, deliveryLeasePreserved=True,
                            cloudTerminalityVerified=False, deliveryResumed=False))
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=20)
    probe('pac-after-crash', 'pac', ['solution', 'list', '--environment', TARGET, '--json'])
    whoami('dataverse-final')
    write(ROOT / 'report.json', dict(scope='authenticated-read-only-native-verification',
          at=datetime.datetime.now(datetime.timezone.utc).isoformat(), environmentUrl=TARGET,
          organizationId=baseline['OrganizationId'], userId=baseline['UserId'], inventoryCount=len(inventory),
          tenantMutations=0, deliveryResumed=False, results=results))
    print('Authenticated read-only native verification passed: ' + str(ROOT / 'report.json'), flush=True)
except Exception as error:
    write(ROOT / 'failure.json', dict(error=str(error), results=results, deliveryResumed=False))
    print('Live verification failed; preserved evidence: ' + str(ROOT / 'failure.json'), flush=True)
    raise
