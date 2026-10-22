"""Real normal-service pinned-artifact workflow and authenticated crash recovery.
Only the previously approved empty Development probe may be imported.
"""
import datetime,hashlib,json,os,pathlib,subprocess,time,uuid
REPO=pathlib.Path(__file__).resolve().parents[1]
ROOT=REPO/'output'/('tracked-import-recovery-normal-'+uuid.uuid4().hex);ROOT.mkdir()
TARGET='https://org68dad46d.crm4.dynamics.com'
result={'scope':'authenticated-normal-service-pinned-artifact-recovery','root':str(ROOT),'normalDeliveryServiceApis':True,'pinnedArtifactWorkflow':True,'normalGitHubAppRelease':False,'deliveryResumed':False}
child=None;log=None

def write(name,value):(ROOT/name).write_text(json.dumps(value,indent=2),encoding='utf-8')
def load(name):
    try:return json.loads((ROOT/name).read_text(encoding='utf-8'))
    except FileNotFoundError:return None

def query(id):
    p=subprocess.run(['dataverse.cmd','api','request','--target','dataverse','--environment',TARGET,'--method','GET','--path','/api/data/v9.2/importjobs('+id+')?$select=importjobid,solutionname,startedon,completedon,progress,data'],capture_output=True,text=True,timeout=30)
    return {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':p.returncode,'row':json.loads(p.stdout)}
try:
    print(ROOT,flush=True)
    cloned=subprocess.run(['git','-c','core.hooksPath=','-c','core.fsmonitor=false','clone','--no-checkout','--depth','1','https://github.com/leongodwin/Expnese-App2.git',str(ROOT/'source')],cwd=REPO,capture_output=True,timeout=120)
    (ROOT/'source-clone.log').write_bytes(cloned.stdout+cloned.stderr)
    if cloned.returncode:raise RuntimeError('Read-only source clone failed')
    subprocess.run(['node','--import','tsx','scripts/prepare-normal-probe-source.ts',str(ROOT)],cwd=REPO,check=True,capture_output=True,timeout=40)
    env=os.environ.copy();env.update(SWARM_HOME=str(ROOT),SWARM_PORT='0')
    log=open(ROOT/'normal-pipeline.log','wb')
    child=subprocess.Popen(['node','--import','tsx','scripts/live-normal-pipeline-child.ts',str(ROOT)],cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT)
    deadline=time.monotonic()+900;operation=None;state=None
    while time.monotonic()<deadline:
        state=load('delivery.json')
        if state and state['runs'] and state['runs'][0].get('operations'):
            operation=state['runs'][0]['operations'][0];break
        if child.poll() is not None:raise RuntimeError('Normal service exited before import intent; inspect normal-pipeline.log')
        time.sleep(.2)
    if not operation or not operation.get('platformJobId'):raise RuntimeError('No independently reviewed normal-service import intent before deadline')
    run=state['runs'][0];write('pre-crash-state.json',state);write('ready.json',{'runId':run['id'],'platformJobId':operation['platformJobId'],'source':'durable normal DeliveryService state before crash'})
    observations=[];killed=False;deadline=time.monotonic()+60
    while time.monotonic()<deadline:
        item=query(operation['platformJobId']);item['ownerRunning']=child.poll() is None;observations.append(item)
        if item['exit']==0 and item['row'].get('startedon') and not item['row'].get('completedon') and child.poll() is None:
            child.kill();child.wait(timeout=20);killed=True;break
        if child.poll() is not None:break
        time.sleep(.5)
    write('crash-observations.json',observations)
    if not killed:raise RuntimeError('No genuine normal-service in-flight job observed; no crash recovery claim')
    result.update(killedOwnerPid=child.pid,platformJobId=operation['platformJobId'],runId=run['id'],releaseId=run['releaseId'],preDispatchJobPersisted=True)
    lease=(ROOT/'delivery.lock').read_bytes();epoch=ROOT/'delivery-native'/hashlib.sha256(lease).hexdigest();deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        intents=list(epoch.glob('*.intent.json'));native=list(epoch.glob('*.tree.json'));local=list(epoch.glob('*.local.json'))
        if intents and len(intents)==len(native)+len(local):break
        time.sleep(.2)
    if not intents or len(intents)!=len(native)+len(local):raise RuntimeError('Incomplete normal-service native/preparation epoch')
    for file in intents:
        intent=json.loads(file.read_text());suffix='.local.json' if 'localPreparation' in intent else '.tree.json';proof=json.loads(file.with_name(file.name.replace('.intent.json',suffix)).read_text())
        if proof['intentSha256']!=hashlib.sha256(file.read_bytes()).hexdigest():raise RuntimeError('Proof attribution differs')
        if suffix=='.tree.json' and (proof['activeProcesses']!=0 or proof['breakawayAllowed']):raise RuntimeError('Native process tree not quiescent')
        if suffix=='.local.json' and proof['scope']!='runner-owned-local-files':raise RuntimeError('Local preparation scope differs')
    result.update(nativeProofCount=len(native),localPreparationReceipts=len(local),sourceCommit=run['head'])
    terminal=[];deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        item=query(operation['platformJobId']);terminal.append(item)
        if item['exit']==0 and item['row'].get('completedon') and len(terminal)>1 and terminal[-2]['row']==item['row']:break
        time.sleep(2)
    write('terminal-observations.json',terminal)
    if not terminal[-1]['row'].get('completedon'):raise RuntimeError('Remote import remains unresolved')
    write('report.json',result)
    recovered=subprocess.run(['python','scripts/verify-tracked-import-recovery.py','--resume-root',str(ROOT)],cwd=REPO,capture_output=True,timeout=160)
    (ROOT/'http-recovery-coordinator.log').write_bytes(recovered.stdout+recovered.stderr)
    result=load('report.json')
    if recovered.returncode or not result.get('deliveryResumed'):raise RuntimeError('Authenticated normal-service adoption refused; inspect HTTP recovery evidence')
except Exception as error:
    result['error']=str(error);raise
finally:
    if child is not None and child.poll() is None:child.kill();child.wait(timeout=20)
    if log is not None:log.close()
    write('report.json',result);print(json.dumps(result),flush=True)
