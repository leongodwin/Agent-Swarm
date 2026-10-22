"""Validate the explicitly approved empty probe package; never authenticates."""
import hashlib, pathlib, sys, zipfile, xml.etree.ElementTree as ET

def validate(file, expected):
    data=pathlib.Path(file).read_bytes()
    if not data or len(data)>1024*1024 or hashlib.sha256(data).hexdigest()!=expected:
        raise ValueError('Probe package digest/size mismatch')
    with zipfile.ZipFile(file) as archive:
        if sorted(archive.namelist())!=sorted(['solution.xml','customizations.xml','[Content_Types].xml']):
            raise ValueError('Probe contains unexpected entries')
        docs={name:archive.read(name) for name in ['solution.xml','customizations.xml']}
        if any(len(body)>200000 or b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper() for body in docs.values()):
            raise ValueError('Unsafe or oversized XML')
        manifest=ET.fromstring(docs['solution.xml']).find('SolutionManifest')
        for key, value in [('UniqueName','CubeFarmResumeProbe'),('Managed','0'),('Publisher/UniqueName','exp'),('Publisher/CustomizationPrefix','exp')]:
            if manifest is None or manifest.findtext(key)!=value:
                raise ValueError('Approved solution binding mismatch: '+key)
        roots=manifest.find('RootComponents')
        if roots is None or len(roots):
            raise ValueError('Probe has solution components')
        custom=ET.fromstring(docs['customizations.xml'])
        allowed={'Entities','Roles','Workflows','FieldSecurityProfiles','Templates','EntityMaps','EntityRelationships','OrganizationSettings','optionsets','CustomControls','EntityDataProviders','Languages'}
        if any(item.tag not in allowed or (item.tag!='Languages' and (len(item) or (item.text or '').strip())) for item in custom):
            raise ValueError('Probe has customizations')
        languages=custom.find('Languages')
        if languages is not None and any(item.tag!='Language' or item.text!='1033' for item in languages):
            raise ValueError('Unexpected language customization')
    return expected

if __name__=='__main__':
    print(validate(sys.argv[1],sys.argv[2]))
