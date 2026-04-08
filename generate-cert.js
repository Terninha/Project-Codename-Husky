// Generate self-signed certificate for localhost
const pem = require('pem');
const fs = require('fs');
const selfsigned = require('selfsigned');

pem.createCertificate({ days: 365, selfSigned: true }, function (err, keys) {
    if (!err && keys?.serviceKey && keys?.certificate) {
        fs.writeFileSync('server.key', keys.serviceKey);
        fs.writeFileSync('server.crt', keys.certificate);
        console.log('Certificate generated!');
        return;
    }

    console.log('Using fallback certificate...');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, { days: 365 });
    fs.writeFileSync('server.key', pems.private);
    fs.writeFileSync('server.crt', pems.cert);
    console.log('Fallback certificate generated!');
});
