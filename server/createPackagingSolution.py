"""Fixed SDK operation for the independently approved packaging preparation."""
import base64,json,sys,time
from azure.identity import AzureCliCredential
from azure.core.credentials import AccessToken
from PowerPlatform.Dataverse.client import DataverseClient
from PowerPlatform.Dataverse.core.config import OperationContext,DataverseConfig

class PinnedCredential:
    def __init__(self,token,scope):
        self.token,self.scope=token,scope
    def get_token(self,*scopes,**kwargs):
        if scopes!=(self.scope,) or self.token.expires_on<=time.time()+30:
            raise RuntimeError('Unapproved SDK scope or expired executing token')
        return self.token

def make_client(spec,credential):
    scope=spec['environmentUrl'].rstrip('/')+'/.default'
    token=credential.get_token(scope)
    claims=json.loads(base64.urlsafe_b64decode(token.token.split('.')[1]+'==='))
    if claims['tid'].lower()!=spec['tenantId'].lower() or claims['oid'].lower()!=spec['subject'].lower() or claims['aud'].rstrip('/')!=spec['environmentUrl'].rstrip('/') or claims['exp']<=time.time()+30:
        raise RuntimeError('SDK executing identity differs')
    pinned=PinnedCredential(AccessToken(token.token,min(token.expires_on,claims['exp'])),scope)
    return DataverseClient(base_url=spec['environmentUrl'],credential=pinned,config=DataverseConfig(http_retries=1,http_timeout=30,operation_context=OperationContext(user_agent_context='app=dataverse-skills/1.16.0;skill=dv-solution;agent=codex')))

def create(spec):
    client=make_client(spec,AzureCliCredential(tenant_id=spec['tenantId']))
    try:
        client.records.create('solution',{'solutionid':spec['solutionId'],'uniquename':spec['solutionName'],'friendlyname':spec['displayName'],'version':'1.0.0.0','description':spec['marker'],'publisherid@odata.bind':'/publishers('+spec['publisherId']+')'})
    finally:
        client.close()
    return {'solutionId':spec['solutionId']}

if __name__=='__main__':
    with open(sys.argv[1],encoding='utf-8') as source:
        print(json.dumps(create(json.load(source))))
