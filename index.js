require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { poolSilverLens, poolElder } = require('./dbConfig');
const fs = require('fs');
const path = require('path');
const flash = require('connect-flash');

const app = express();
const DATA_FILE_PATH = path.join(__dirname, 'public', 'communitiesData.json');

// Enable CORS
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);
app.use(flash());
app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});
app.use(passport.initialize());
app.use(passport.session());

// Helper function to get IP address
const getIPAddress = (req) => {
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    return ip === '::1' ? '127.0.0.1' : ip;
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

// Fetch communities data from Elder database
async function fetchCommunitiesData() {
    try {
        await connectToElderDatabase();
        const request = poolElder.request();
        const result = await request.query('SELECT * FROM [Elder].[dbo].[vCommunities]');
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(result.recordset, null, 2), 'utf-8');
        console.log('Communities data fetched and saved.');
    } catch (err) {
        console.error('Error fetching communities data:', err);
    }
}
fetchCommunitiesData();

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: 'Yahoo',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
    },
});

passport.use(
    new LocalStrategy(
        { usernameField: 'email', passwordField: 'password' }, // Map to 'email' and 'password'
        async (username, password, done) => {
            try {
                const request = poolSilverLens.request();
                console.log('Authenticating user:', username);
                const result = await request
                    .input('email', username)
                    .query('SELECT * FROM [User] WHERE email = @email');

                if (result.recordset.length === 0) {
                    console.log('User not found');
                    return done(null, false, { message: 'Invalid email or password.' });
                }

                const user = result.recordset[0];
                const isValidPassword = await bcrypt.compare(password, user.password);

                if (!isValidPassword) {
                    console.log('Invalid password');
                    return done(null, false, { message: 'Invalid email or password.' });
                }

                return done(null, user);
            } catch (err) {
                console.error('Error during authentication:', err);
                return done(err);
            }
        }
    )
);


// SHS Sign-up Route
app.post('/auth/shs-signup', async (req, res, next) => {
    const { email, password, firstName, lastName } = req.body;
    console.log('Sign-up attempt for:', email);

    if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const request = poolSilverLens.request();
        request.input('email', email);

        const userCheck = await request.query('SELECT * FROM [User] WHERE email = @email');
        if (userCheck.recordset.length > 0) {
            console.log('User already exists:', email);
            return res.status(409).json({ message: 'User already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        request.input('password', hashedPassword)
               .input('firstName', firstName)
               .input('lastName', lastName);

        await request.query(`
            INSERT INTO [User] (email, password, firstName, lastName)
            VALUES (@email, @password, @firstName, @lastName)
        `);
        console.log('User created:', email);

        const mailOptions = {
            from: 'flowayz@yahoo.com',
            to: email,
            subject: 'Welcome to Silver Lens!',
            text: `Dear ${firstName},\n\nYour account has been created successfully. Use your email and password to log in.\n\nBest Regards,\nSilver Lens Team`,
        };

        await transporter.sendMail(mailOptions);
        console.log('Welcome email sent to:', email);
        req.login({ email, password }, (err) => {
            if (err) return next(err);
            return res.redirect('http://localhost:3001/home-page');
        });
    } catch (err) {
        console.error('Error during sign-up:', err);
        res.status(500).json({ message: 'Server error. Please try again later.' });
    }
});

// Function to handle user authentication
const handleUserAuthentication = async (req, email, providerName, profile, done) => {
    if (!email) return done(new Error(`No email found in ${providerName} profile`));
    console.log(`Handling authentication for ${providerName} user: ${email}`);

    try {
        const request = poolSilverLens.request();
        request.input('email', email);

        const result = await request.query('SELECT userID FROM [User] WHERE email = @email');
        let userId;

        if (result.recordset.length === 0) {
            request.input('firstName', profile.name.givenName)
                   .input('lastName', profile.name.familyName);
            const insertUser = await request.query(
                'INSERT INTO [User] (firstName, lastName, email) OUTPUT INSERTED.userID VALUES (@firstName, @lastName, @email)'
            );
            userId = insertUser.recordset[0].userID;
            console.log('New user created:', email);
        } else {
            userId = result.recordset[0].userID;
            console.log('User found in database:', email);
        }

        request.input('providerName', providerName);
        const providerCheck = await request.query('SELECT providerID FROM [OAuthProvider] WHERE providerName = @providerName');
        let providerId = providerCheck.recordset.length > 0 ? providerCheck.recordset[0].providerID : null;

        if (!providerId) {
            const insertProvider = await request.query(
                'INSERT INTO [OAuthProvider] (providerName) OUTPUT INSERTED.providerID VALUES (@providerName)'
            );
            providerId = insertProvider.recordset[0].providerID;
            console.log('New provider added:', providerName);
        }

        const ipAddress = getIPAddress(req);
        const userAgent = req.headers['user-agent'];
        request.input('userID', userId)
               .input('providerID', providerId)
               .input('ipAddress', ipAddress)
               .input('userAgent', userAgent);
        const sessionInsert = await request.query(
            `INSERT INTO [Session] (userID, providerID, loginTime, ipAddress, userAgent)
             OUTPUT INSERTED.sessionID
             VALUES (@userID, @providerID, GETDATE(), @ipAddress, @userAgent)`
        );

        req.session.sessionID = sessionInsert.recordset[0].sessionID;
        console.log('Session created for user:', email);
        req.session.save((err) => {
            if (err) return done(err);
            return done(null, profile);
        });
    } catch (err) {
        console.error('Error handling user authentication:', err);
        return done(err);
    }
};

// Google OAuth
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
            passReqToCallback: true,
        },
        (req, accessToken, refreshToken, profile, done) => {
            const email = profile.emails && profile.emails[0].value;
            handleUserAuthentication(req, email, 'Google', profile, done);
        }
    )
);

// Microsoft OAuth
passport.use(
    new MicrosoftStrategy(
        {
            clientID: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            callbackURL: process.env.MICROSOFT_CALLBACK_URL,
            scope: ['user.read'],
            passReqToCallback: true,
        },
        (req, accessToken, refreshToken, profile, done) => {
            const email = profile.emails && profile.emails[0].value;
            handleUserAuthentication(req, email, 'Microsoft', profile, done);
        }
    )
);

// Serialize/Deserialize User
passport.serializeUser((user, done) => {
    console.log('Serializing user:', user);
    done(null, user);
});
passport.deserializeUser((user, done) => {
    console.log('Deserializing user:', user);
    done(null, user);
});

// Routes
app.get('/', (req, res) =>
    res.send(`
    <h1>Welcome to the homepage</h1>
    <a href="/auth/google">Login with Google</a>
    <a href="/auth/microsoft">Login with Microsoft</a>
    <form action="/auth/shs" method="post">
        <input type="text" name="username" placeholder="Email" required />
        <input type="password" name="password" placeholder="Password" required />
        <button type="submit">Login with SHS</button>
    </form>
`));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => res.redirect('http://localhost:3001/home-page')
);

app.get('/auth/microsoft', passport.authenticate('microsoft'));
app.get(
    '/auth/microsoft/callback',
    passport.authenticate('microsoft', { failureRedirect: '/' }),
    (req, res) => res.redirect('http://localhost:3001/home-page')
);

app.post('/auth/shs', (req, res, next) => {
    console.log('SHS Login route hit');
    console.log('Email:', req.body.email);
    console.log('Password:', req.body.password);

    passport.authenticate('local', async (err, user, info) => {
        if (err) {
            console.error('Error during authentication:', err);
            return next(err);
        }
        if (!user) {
            console.log('Authentication failed:', info.message);
            return res.status(401).json({ message: info.message || 'Invalid email or password.' });
        }

        try {
            // Session management: Record the session details
            const request = poolSilverLens.request();
            const ipAddress = getIPAddress(req);
            const userAgent = req.headers['user-agent'];
            const providerID = 3; // Assuming 3 is the ID for SHS in the `OAuthProvider` table

            request.input('userID', user.userID)
                   .input('providerID', providerID)
                   .input('ipAddress', ipAddress)
                   .input('userAgent', userAgent);

            const sessionInsert = await request.query(`
                INSERT INTO [Session] (userID, providerID, loginTime, ipAddress, userAgent)
                OUTPUT INSERTED.sessionID
                VALUES (@userID, @providerID, GETDATE(), @ipAddress, @userAgent)
            `);

            req.session.sessionID = sessionInsert.recordset[0].sessionID;
            console.log('Session created for SHS user:', user.email);

            req.login(user, (err) => {
                if (err) {
                    console.error('Error during login:', err);
                    return next(err);
                }
                req.session.save((saveErr) => {
                    if (saveErr) {
                        console.error('Error saving session:', saveErr);
                        return next(saveErr);
                    }
                    console.log('Login successful, redirecting to /home-page');
                    return res.status(200).json({ redirectUrl: 'http://localhost:3001/home-page' });
                });
            });
        } catch (err) {
            console.error('Error during session management for SHS:', err);
            return next(err);
        }
    })(req, res, next);
});

// Home API route to return JSON data
app.get('/home', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    const user = {
        firstName: req.user.firstName || req.user.name?.givenName,
        lastName: req.user.lastName || req.user.name?.familyName,
        email: req.user.email || req.user.emails?.[0]?.value,
    };
    console.log('User loaded for /home:', user);
    res.json(user);
});

// Serve profile.html at /home-page route
app.get('/home-page', (req, res) => {
    console.log('Accessing /home-page route');
    if (!req.isAuthenticated()) {
        console.log('User not authenticated, redirecting');
        return res.redirect('/');
    }
    console.log('User authenticated, serving home.html');
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Fetch communities data routes
app.get('/internal/get-total-communities', (req, res) => {
    try {
        const data = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
        const communities = JSON.parse(data);
        res.json({ totalCommunities: communities.length });
    } catch (err) {
        console.error('Error reading communities data:', err);
        res.status(500).send('Error reading data');
    }
});

app.get('/internal/get-communities', (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).send('Access denied');
    const { neLat, neLng, swLat, swLng, zoom, state } = req.query;
    const northEastLat = parseFloat(neLat);
    const northEastLng = parseFloat(neLng);
    const southWestLat = parseFloat(swLat);
    const southWestLng = parseFloat(swLng);
    if (isNaN(northEastLat) || isNaN(northEastLng) || isNaN(southWestLat) || isNaN(southWestLng))
        return res.status(400).json({ error: 'Invalid coordinates' });

    const limit = zoom > 10 ? 2000 : 1000;
    let sqlQuery = `
        SELECT TOP ${limit} 
            FacilityName, FacStreetAddress, FacCity, FacState, FacPostalCode, 
            TRY_CAST(FacLatitude AS FLOAT) AS FacLatitude, TRY_CAST(FacLongitude AS FLOAT) AS FacLongitude, CareTypes
        FROM [Elder].[dbo].[vCommunities]
        WHERE TRY_CAST(FacLatitude AS FLOAT) BETWEEN ${southWestLat} AND ${northEastLat} 
          AND TRY_CAST(FacLongitude AS FLOAT) BETWEEN ${southWestLng} AND ${northEastLng}
    `;
    if (state) sqlQuery += ` AND FacState = '${state}'`;

    poolElder
        .request()
        .query(sqlQuery)
        .then((result) => res.json(result.recordset))
        .catch((err) => {
            console.error('Error fetching communities data:', err);
            res.status(500).send({ error: 'Error fetching communities data' });
        });
});


// Logout route
app.get('/logout', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const request = poolSilverLens.request();
            
            // Retrieve sessionID from the session or explicitly query it from the database
            let sessionID = req.session.sessionID;
            
            if (!sessionID) {
                // If sessionID is not available, query it explicitly using the email
                const email = req.user.email;
                const result = await request.query(`
                    SELECT TOP 1 sessionID 
                    FROM [Session] 
                    WHERE userID = (SELECT userID FROM [User] WHERE email = '${email}')
                    ORDER BY loginTime DESC
                `);
                sessionID = result.recordset[0]?.sessionID;
            }
            
            if (sessionID) {
                // Update the logout time for the session
                await request.query(`UPDATE [Session] SET logoutTime = GETDATE() WHERE sessionID = ${sessionID}`);
                console.log('Session logout time updated for SHS user');
            } else {
                console.error('No sessionID found for SHS user');
            }
        } catch (err) {
            console.error('Error updating session logout time:', err);
        }
        req.logout(() => req.session.destroy(() => res.redirect('http://localhost:3000/')));
    } else {
        res.redirect('http://localhost:3000/');
    }
});


// Start server
app.listen(3001, () => console.log('Node.js server running on http://localhost:3001'));
