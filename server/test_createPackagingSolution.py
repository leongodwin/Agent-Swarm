import base64,json,time,unittest
from unittest.mock import Mock,patch
import requests
from azure.core.credentials import AccessToken
from createPackagingSolution import make_client

TENANT='11111111-1111-4111-8111-111111111111'
SUBJECT='22222222-2222-4222-8222-222222222222'
URL='https://example.crm4.dynamics.com'
def token(subject=SUBJECT,expiry=None):
    expires=expiry or int(time.time()+3600)
    claims={'tid':TENANT,'oid':subject,'aud':URL,'exp':expires}
    return AccessToken('header.'+base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')+'.synthetic',expires)

class PackagingSdkTests(unittest.TestCase):
    def client(self,credential):
        client=make_client({'tenantId':TENANT,'subject':SUBJECT,'environmentUrl':URL},credential)
        self.addCleanup(client.close)
        return client
    def test_installed_constructor_and_one_http_attempt(self):
        credential=Mock();credential.get_token.return_value=token()
        client=self.client(credential)
        transport=client._get_odata()._http
        self.assertEqual(transport.max_attempts,1)
        self.assertEqual(transport.default_timeout,30)
        with patch('requests.request',side_effect=requests.ConnectionError('synthetic dropped POST')) as request:
            with self.assertRaises(requests.ConnectionError):
                transport._request('POST',URL+'/api/data/v9.2/solutions',json={'uniquename':'Synthetic'})
            self.assertEqual(request.call_count,1)
    def test_sdk_actual_headers_use_only_the_validated_token(self):
        original=token();credential=Mock();credential.get_token.side_effect=[original,token(TENANT)]
        client=self.client(credential);odata=client._get_odata()
        self.assertEqual(odata._headers()['Authorization'],'Bearer '+original.token)
        self.assertEqual(odata._headers()['Authorization'],'Bearer '+original.token)
        self.assertEqual(credential.get_token.call_count,1)
    def test_wrong_subject_never_constructs_writer(self):
        credential=Mock();credential.get_token.return_value=token(TENANT)
        with self.assertRaisesRegex(RuntimeError,'identity differs'):
            self.client(credential)
    def test_expired_token_never_constructs_writer(self):
        credential=Mock();credential.get_token.return_value=token(expiry=int(time.time()-1))
        with self.assertRaisesRegex(RuntimeError,'identity differs'):
            self.client(credential)

if __name__=='__main__':unittest.main()
