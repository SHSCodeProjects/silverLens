require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const { poolSilverLens, poolElder } = require('./dbConfig');
const fs = require('fs');
const path = require('path');
const app = express();

const DATA_FILE_PATH = path.join(__dirname, 'public', 'communitiesData.json');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Helper to get the correct IP address
const getIPAddress = (req) => {
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7); // Remove IPv6 prefix for IPv4 addresses
    }
    return ip === '::1' ? '127.0.0.1' : ip; // Handle local loopback
};

// Connect to Elder database
const connectToElderDatabase = async () => {
    try {
        await poolElder.connect();
        console.log('Connected to Elder database');
    } catch (err) {
        console.error('Connection to Elder database failed:', err);
    }
};

// Fetch communities data from Elder database on app startup
async function fetchCommunitiesData() {
    try {
        await connectToElderDatabase(); // Ensure connection to Elder database is established

        const request = poolElder.request();
        const result = await request.query('SELECT * FROM [Elder].[dbo].[vCommunities]');
        
        // Save result to a file for internal use
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(result.recordset, null, 2), 'utf-8');
        console.log('Communities data fetched and saved.');
    } catch (err) {
        console.error('Error fetching communities data:', err);
    }
}

// Fetch the data when the app starts
fetchCommunitiesData();

// Common function to handle user authentication and session storage
const handleUserAuthentication = async (req, email, providerName, profile, done) => {
    if (!email) {
        return done(new Error(`No email found in ${providerName} profile`));
    }

    try {
        const request = poolSilverLens.request();

        // Check if the user exists in the database
        const result = await request.query(`SELECT userID FROM [User] WHERE email = '${email}'`);
        let userId;

        if (result.recordset.length === 0) {
            // Insert a new user if not found
            const insertUser = await request.query(`
                INSERT INTO [User] (firstName, lastName, email)
                OUTPUT INSERTED.userID
                VALUES ('${profile.name.givenName}', '${profile.name.familyName}', '${email}')
            `);
            userId = insertUser.recordset[0].userID;
        } else {
            userId = result.recordset[0].userID;
        }

        // Ensure the provider exists in OAuthProvider
        const providerCheck = await request.query(`SELECT providerID FROM [OAuthProvider] WHERE providerName = '${providerName}'`);
        let providerId;

        if (providerCheck.recordset.length === 0) {
            const insertProvider = await request.query(`
                INSERT INTO [OAuthProvider] (providerName)
                OUTPUT INSERTED.providerID
                VALUES ('${providerName}')
            `);
            providerId = insertProvider.recordset[0].providerID;
        } else {
            providerId = providerCheck.recordset[0].providerID;
        }

        // Log the session in the database
        const ipAddress = getIPAddress(req);
        const userAgent = req.headers['user-agent'];

        const sessionInsert = await request.query(`
            INSERT INTO [Session] (userID, providerID, loginTime, ipAddress, userAgent)
            OUTPUT INSERTED.sessionID
            VALUES (${userId}, ${providerId}, GETDATE(), '${ipAddress}', '${userAgent}')
        `);

        // Store sessionID in the session object
        req.session.sessionID = sessionInsert.recordset[0].sessionID;

        // Force saving the session
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session:', err);
                return done(err);
            }
            console.log('Session saved with sessionID:', req.session.sessionID);
            return done(null, profile);
        });
    } catch (err) {
        return done(err);
    }
};

// Passport Google OAuth strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
    const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
    handleUserAuthentication(req, email, 'Google', profile, done);
}));

// Passport Microsoft OAuth strategy
passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: process.env.MICROSOFT_CALLBACK_URL,
    scope: ['user.read'],
    passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
    const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
    handleUserAuthentication(req, email, 'Microsoft', profile, done);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// Home route
app.get('/', (req, res) => {
    res.send(`
        <h1>Welcome to the homepage</h1>
        <a href="/auth/google">Login with Google</a>
        <a href="/auth/microsoft">Login with Microsoft</a>
    `);
});

// Google OAuth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/home-page');
    }
);

// Microsoft OAuth Routes
app.get('/auth/microsoft', passport.authenticate('microsoft'));

app.get('/auth/microsoft/callback',
    passport.authenticate('microsoft', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/home-page');
    }
);

// home API route to return JSON data
app.get('/home', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/google');
    }

    const user = {
        firstName: req.user.name.givenName,
        lastName: req.user.name.familyName,
        email: req.user.emails[0].value
    };

    res.json(user);
});

// Serve profile.html at /profile-page route
app.get('/home-page', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/google');
    }
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// New endpoint to fetch total number of communities
app.get('/internal/get-total-communities', (req, res) => {
    try {
        // Read and return the saved data from the file
        const data = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
        const communities = JSON.parse(data);

        // Send back the total number of communities
        res.json({ totalCommunities: communities.length });
    } catch (err) {
        console.error('Error reading communities data:', err);
        res.status(500).send('Error reading data');
    }
});


// Internal endpoint to fetch communities data within map bounds, filtered by state
app.get('/internal/get-communities', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('Access denied');
    }

    const { neLat, neLng, swLat, swLng, zoom, state } = req.query;

    // Ensure latitude and longitude values are numbers
    const northEastLat = parseFloat(neLat);
    const northEastLng = parseFloat(neLng);
    const southWestLat = parseFloat(swLat);
    const southWestLng = parseFloat(swLng);

    if (isNaN(northEastLat) || isNaN(northEastLng) || isNaN(southWestLat) || isNaN(southWestLng)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // Adjust the LIMIT based on the zoom level (more zoom, more data)
    const limit = zoom > 10 ? 2000 : 1000;

    // Build SQL query with optional filtering
    let sqlQuery = `
        SELECT TOP ${limit} 
            FacilityName, 
            FacStreetAddress, 
            FacCity, 
            FacState, 
            FacPostalCode, 
            TRY_CAST(FacLatitude AS FLOAT) AS FacLatitude, 
            TRY_CAST(FacLongitude AS FLOAT) AS FacLongitude, 
            CareTypes
        FROM [Elder].[dbo].[vCommunities]
        WHERE TRY_CAST(FacLatitude AS FLOAT) BETWEEN ${southWestLat} AND ${northEastLat} 
          AND TRY_CAST(FacLongitude AS FLOAT) BETWEEN ${southWestLng} AND ${northEastLng}
    `;

    // Add filtering by state if provided
    if (state) {
        sqlQuery += ` AND FacState = '${state}'`;
    }

    poolElder.request()
        .query(sqlQuery)
        .then(result => {
            res.json(result.recordset);
        })
        .catch(err => {
            console.error('Error fetching communities data:', err);
            res.status(500).send({ error: 'Error fetching communities data' });
        });
});





// Logout route with direct SQL update for logoutTime
app.get('/logout', async (req, res) => {
    console.log('GET /logout - Logout initiated');
    console.log('Session before logout:', req.session);

    if (req.isAuthenticated()) {
        try {
            const request = poolSilverLens.request();

            // Check if session ID is available in session or fallback to query
            let sessionID = req.session.sessionID;

            if (!sessionID) {
                // If sessionID is undefined, try to retrieve it from the database
                console.error('Session ID not found in session, querying from database...');
                const userResult = await request.query(`SELECT sessionID FROM [Session] WHERE userID = (SELECT userID FROM [User] WHERE email = '${req.user.emails[0].value}') ORDER BY loginTime DESC`);
                
                if (userResult.recordset.length > 0) {
                    sessionID = userResult.recordset[0].sessionID;
                    console.log(`Recovered sessionID from database: ${sessionID}`);
                } else {
                    console.error('No session found in database for this user');
                }
            }

            if (sessionID) {
                console.log(`Updating logout time for sessionID: ${sessionID}`);
                await request.query(`UPDATE [Session] SET logoutTime = GETDATE() WHERE sessionID = ${sessionID}`);
                console.log('Logout time updated');
            }
        } catch (err) {
            console.error('Error updating logout time:', err);
        }

        // Perform the logout and destroy the session
        req.logout((err) => {
            if (err) {
                console.error('Error logging out:', err);
                return res.redirect('/');
            }

            req.session.destroy((err) => {
                if (err) {
                    console.error('Error destroying session:', err);
                    return res.redirect('/');
                }
                console.log('Session destroyed successfully');
                res.redirect('http://localhost:3000/');
            });
        });
    } else {
        res.redirect('/');
    }
});

// Start server
app.listen(3001, () => {
    console.log("Node.js server running on http://localhost:3001");
});
