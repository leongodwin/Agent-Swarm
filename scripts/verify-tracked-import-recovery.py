"""Authenticated empty-probe crash recovery. Uses native CLIs; no auth code.
Local release metadata is a declared integration contract, not a pipeline release.
"""
import datetime,hashlib,json,os,pathlib,subprocess,time,uuid,urllib.request,urllib.error,sys
REPO=pathlib.Path(__file__).resolve().parents[1]
TARGET='https://org68dad46d.crm4.dynamics.com'
RESUME_ONLY=len(sys.argv)==3 and sys.argv[1]=='--resume-root'
ROOT=pathlib.Path(sys.argv[2]).resolve() if RESUME_ONLY else REPO/'output'/('tracked-import-recovery-'+uuid.uuid4().hex)
if ROOT.parent!=REPO/'output' or not ROOT.name.startswith('tracked-import-recovery-'):raise ValueError('Recovery root must be an owned probe output directory')
if not RESUME_ONLY:ROOT.mkdir()
PACKAGE=REPO/'output/CubeFarmResumeProbe.zip'
TARGET_SPEC={'environmentUrl':TARGET,'binding':{'organizationId':'276d6f5c-20f4-46de-a631-825a64953d21','userId':'5a89d846-73f1-eb11-94ee-000d3ab40fca'},'identity':{'tenantId':'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c','environmentId':'dfa95786-271b-4505-a842-59c54890e019','username':'leon@graspai.co.uk'}}
result={'scope':'authenticated-empty-probe-production-recovery-integration','root':str(ROOT),'normalPipelineRelease':False,'deliveryResumed':False}
if RESUME_ONLY:
    result=json.loads((ROOT/'report.json').read_text(encoding='utf-8'));result.pop('error',None)
children=[];handles=[]
def write(name,value):
    file=ROOT/name
    if file.exists():file.rename(ROOT/(name+'.previous-'+uuid.uuid4().hex))
    file.write_text(json.dumps(value,indent=2),encoding='utf-8')
def start(script,args):
    env=os.environ.copy();env.update(SWARM_HOME=str(ROOT),SWARM_PORT='0')
    log=open(ROOT/(pathlib.Path(script).stem+'.log'),'ab');handles.append(log)
    p=subprocess.Popen(['node','--import','tsx',script,*args],cwd=REPO,env=env,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT);children.append(p);return p

def waitfile(name,p,seconds=50):
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        file=ROOT/name
        if file.exists():
            value=json.loads(file.read_text(encoding='utf-8'))
            if name!='recovery-server-ready.json' or value.get('pid')==p.pid:return value
        if p.poll() is not None:raise RuntimeError(script_status(p)+' before '+name)
        time.sleep(.2)
    raise RuntimeError('Timed out waiting '+name)
def script_status(p):return 'Owned child '+str(p.pid)+' exited '+str(p.returncode)
def job(id):
    path='/api/data/v9.2/importjobs('+id+')?$select=importjobid,solutionname,startedon,completedon,progress,data'
    p=subprocess.run(['dataverse.cmd','api','request','--target','dataverse','--environment',TARGET,'--method','GET','--path',path],cwd=REPO,capture_output=True,text=True,timeout=30)
    row=json.loads(p.stdout)
    return {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':p.returncode,'row':row}
def http(base,path,body=None,cookie=None):
    headers={'Origin':base}
    if cookie:headers['Cookie']=cookie
    if body is not None:headers['Content-Type']='application/json'
    request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with urllib.request.urlopen(request,timeout=120) as response:return response.status,json.load(response),response.headers
    except urllib.error.HTTPError as error:return error.code,json.load(error),error.headers
try:
    if not RESUME_ONLY:
        sha=hashlib.sha256(PACKAGE.read_bytes()).hexdigest()
        subprocess.run(['python','scripts/validate-empty-probe.py',str(PACKAGE),sha],cwd=REPO,check=True,capture_output=True)
        input={'root':str(ROOT),'packageFile':str(PACKAGE),'packageSha256':sha,'target':TARGET_SPEC,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()}
        write('input.json',input);print(ROOT,flush=True)
        child=start('scripts/live-tracked-import-child.ts',[str(ROOT/'input.json')]);ready=waitfile('ready.json',child)
        # This ID comes exclusively from the pre-dispatch production state, never
        # from querying by solution name, last job or approximate timestamp.
        saved=json.loads((ROOT/'delivery.json').read_text());operation=saved['runs'][0]['operations'][0]
        if operation['platformJobId']!=ready['platformJobId'] or operation['status']!='intent':raise RuntimeError('No pre-dispatch durable attribution')
        observations=[];deadline=time.monotonic()+90;killed=False
        while time.monotonic()<deadline:
            observation=job(ready['platformJobId']);observation['ownerRunning']=child.poll() is None;observations.append(observation)
            row=observation['row']
            if observation['exit']==0 and row.get('startedon') and not row.get('completedon') and child.poll() is None:
                child.kill();child.wait(timeout=20);killed=True;break
            if child.poll() is not None:break
            time.sleep(.5)
        write('crash-observations.json',observations)
        if not killed:raise RuntimeError('No genuine in-flight job observed before caller exit; forced-crash adoption not proven')
        result['killedOwnerPid']=child.pid;result['platformJobId']=ready['platformJobId'];result['preDispatchJobPersisted']=True
        original_lease=(ROOT/'delivery.lock').read_bytes();epoch=ROOT/'delivery-native'/hashlib.sha256(original_lease).hexdigest()
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            intents=list(epoch.glob('*.intent.json'));proofs=list(epoch.glob('*.tree.json'))
            if intents and len(intents)==len(proofs):break
            time.sleep(.2)
        if not intents or len(intents)!=len(proofs):raise RuntimeError('Missing native termination proof')
        for intent_file in intents:
            intent=json.loads(intent_file.read_text());proof=json.loads(intent_file.with_name(intent_file.name.replace('.intent.json','.tree.json')).read_text())
            if proof['intentSha256']!=hashlib.sha256(intent_file.read_bytes()).hexdigest() or proof['activeProcesses']!=0 or proof['breakawayAllowed'] or intent['runId']!=ready['runId']:raise RuntimeError('Unattributable native proof')
        result['nativeProofCount']=len(proofs)
        terminal=[];deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            observation=job(ready['platformJobId']);terminal.append(observation)
            if observation['exit']==0 and observation['row'].get('completedon') and len(terminal)>1 and terminal[-2]['row']==observation['row']:break
            time.sleep(2)
        write('terminal-observations.json',terminal)
        if not terminal[-1]['row'].get('completedon'):raise RuntimeError('Cloud operation remains unresolved')
    # Start a fresh isolated host using real DeliveryService and production HTTP
    # auth/gates. Its unneeded office interfaces are integration stand-ins.
    server=start('scripts/live-tracked-recovery-server.ts',[str(ROOT)]);server_ready=waitfile('recovery-server-ready.json',server)
    base='http://127.0.0.1:'+str(server_ready['port'])
    status,denied,_=http(base,'/api/delivery/recovery/resume',{'snapshotSha256':'0'*64,'targets':[TARGET_SPEC]})
    if status!=401:raise RuntimeError('Unauthenticated recovery was not refused')
    status,_,headers=http(base,'/api/session');cookie=headers['Set-Cookie'].split(';')[0]
    status,inspection,_=http(base,'/api/delivery/recovery',cookie=cookie);write('startup-inspection.json',inspection)
    if status!=200:raise RuntimeError('Recovery inspection failed')
    status,resumed,_=http(base,'/api/delivery/recovery/resume',{'snapshotSha256':inspection['snapshotSha256'],'targets':[TARGET_SPEC]},cookie)
    write('http-resume.json',{'status':status,'response':resumed,'unauthenticatedStatus':401})
    if status!=200 or resumed.get('scope')!='delivery-maintenance-resumption':raise RuntimeError('Authenticated production recovery refused: '+str(resumed))
    state=json.loads((ROOT/'delivery.json').read_text());write('adopted-state.json',state)
    if state['runs'][0]['checkpoint']!='import-started' or state['runs'][0]['phase']!='blocked':raise RuntimeError('Recovery changed uncertain checkpoint or approved deployment')
    archived=[file for file in (ROOT/'delivery-recovery').glob('*/delivery.lock')
              if hashlib.sha256(file.read_bytes()).hexdigest()==state['runs'][0]['nativeLeaseSha256']]
    if len(archived)!=1 or json.loads(archived[0].read_text())['pid']!=result['killedOwnerPid']:
        raise RuntimeError('Original lease archive is not attributable to the killed owner')
    committed=json.loads((archived[0].parent/'committed.json').read_text())
    if not committed.get('nativeTreeQuiescenceVerified') or not committed.get('remoteTerminalityVerified'):
        raise RuntimeError('Handoff does not contain a committed native/cloud receipt')
    result.update(deliveryResumed=True,maintenanceRequired=True,releaseApproved=False,deploymentOutcomeVerified=False,httpStatus=status,originalLeaseArchived=True)
    # Bounded host teardown releases only its own successor lease. The archived
    # original marker, cloud receipt and adopted state remain reviewable.
    server.stdin.write(b'close\n');server.stdin.flush();server.wait(timeout=20)
except Exception as error:
    result['error']=str(error)
    raise
finally:
    for child in children:
        if child.poll() is None:child.kill();child.wait(timeout=20)
    for handle in handles:handle.close()
    write('report.json',result);print(json.dumps(result),flush=True)
