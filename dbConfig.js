const sql = require('mssql');

// Configuration for silverLens database
const dbConfigSilverLens = {
    server: '192.168.129.53',  // Update with your server if not localhost
    database: 'silverLens',
    user: 'svcSilverLens',
    password: 'shs1234!!',
    port: 1433,
    trustServerCertificate: true,
    options: {
        encrypt: true,
    },
    requestTimeout: 120000,
};

// Configuration for Elder database
const dbConfigElder = {
    server: '192.168.129.53',  // Same server as silverLens
    database: 'Elder',
    user: 'svcSilverLens',
    password: 'shs1234!!',
    port: 1433,
    trustServerCertificate: true,
    options: {
        encrypt: true,
    },
    requestTimeout: 120000,
};

// Creating connection pool for silverLens
const poolSilverLens = new sql.ConnectionPool(dbConfigSilverLens);

// Creating connection pool for Elder
const poolElder = new sql.ConnectionPool(dbConfigElder);

// Connect to poolSilverLens and handle connection errors
poolSilverLens.connect()
    .then(() => console.log('Connected to silverLens database'))
    .catch(err => console.error('Connection to silverLens database failed', err));

// Connect to poolElder and handle connection errors
poolElder.connect()
    .then(() => console.log('Connected to Elder database'))
    .catch(err => console.error('Connection to Elder database failed', err));

module.exports = { poolSilverLens, poolElder };
