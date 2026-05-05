const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, '..', 'VercelFrontend');
const staticFiles = [
  'admin-dashboard.html',
  'admin.html',
  'api-config.js',
  'assessment.html',
  'dashboard.html',
  'doctor-dashboard.html',
  'doctor-login.html',
  'doctor-register.html',
  'index.html',
  'login.html',
  'qrcode.min.js',
  'register.html',
  'simple-login.html',
  'staff-login.html',
  'staff-register.html',
  'staff.html',
  'styles.css',
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of staticFiles) {
  fs.copyFileSync(path.join(root, file), path.join(outDir, file));
}

fs.copyFileSync(path.join(root, 'app.js'), path.join(outDir, 'auth-client.js'));

fs.writeFileSync(
  path.join(outDir, 'vercel.json'),
  `${JSON.stringify({
    cleanUrls: true,
    rewrites: [{ source: '/', destination: '/index.html' }],
    headers: [
      {
        source: '/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ],
  }, null, 2)}\n`
);

console.log(`Copied ${staticFiles.length} static files to ${outDir}`);
