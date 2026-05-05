// Setup Test Accounts for EMR System
// Run this to create test accounts for manual testing

const http = require('http');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setup() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        SETUP TEST ACCOUNTS FOR MANUAL TESTING          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Register Doctor
    console.log('📝 Creating Doctor Account...');
    const docRes = await makeRequest('POST', '/api/register', {
      role: 'doctor',
      email: 'doctor@test.com',
      password: 'password123',
      displayName: 'Dr. Smith',
    });

    if (docRes.body.success) {
      console.log('✅ Doctor Account Created');
      console.log('   Email: doctor@test.com');
      console.log('   Password: password123\n');
    } else {
      console.log('❌ Failed:', docRes.body.message, '\n');
    }

    // Register Patient
    console.log('📝 Creating Patient Account...');
    const patRes = await makeRequest('POST', '/api/register', {
      role: 'patient',
      email: 'patient@test.com',
      password: 'password123',
      displayName: 'John Doe',
      username: 'johndoe',
      firstName: 'John',
      lastName: 'Doe',
      mobile: '09123456789',
      dateOfBirth: '1990-05-15',
      age: 34,
      sex: 'M',
      civilStatus: 'Single',
      address: '123 Main Street',
      securityQuestion: 'What is your favorite color?',
      securityAnswer: 'Blue',
    });

    if (patRes.body.success) {
      console.log('✅ Patient Account Created');
      console.log('   Email: patient@test.com');
      console.log('   Password: password123\n');
    } else {
      console.log('❌ Failed:', patRes.body.message, '\n');
    }

    // Register Admin
    console.log('📝 Creating Admin Account...');
    const adminRes = await makeRequest('POST', '/api/register', {
      role: 'staff',
      email: 'staff@test.com',
      password: 'password123',
      displayName: 'Administrator',
    });

    if (adminRes.body.success) {
      console.log('✅ Admin Account Created');
      console.log('   Email: admin@test.com');
      console.log('   Password: password123\n');
    } else {
      console.log('❌ Failed:', adminRes.body.message, '\n');
    }

    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║            READY FOR TESTING                          ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║ Doctor:   doctor@test.com / password123               ║');
    console.log('║ Patient:  patient@test.com / password123              ║');
    console.log('║ Admin:    admin@test.com / password123                ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
}

setup();
