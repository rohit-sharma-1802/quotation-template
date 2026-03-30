require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const hbs = require('hbs');
const path = require('path');
const nodemailer = require('nodemailer');
const pdf = require('html-pdf');
const bodyParser = require('body-parser');
const fs = require('fs');
const mongoose = require('mongoose');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 3600000 // 1 hour in milliseconds
    }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
    if (typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user && req.user.email) {
        if (!req.session.userEmail) {
            req.session.userEmail = String(req.user.email).trim().toLowerCase();
        }
        if (!req.session.userName && req.user.displayName) {
            req.session.userName = String(req.user.displayName).trim();
        }
    }
    next();
});
app.use('/assets', express.static(path.join(__dirname, 'templates/assets')));

// View engine setup
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'templates'));
hbs.registerPartials(path.join(__dirname, 'templates/layouts'));

// Authentication middleware (password session and/or Passport Google)
const authenticateUser = (req, res, next) => {
    if (req.session.authenticated === true || (typeof req.isAuthenticated === 'function' && req.isAuthenticated())) {
        next();
    } else {
        res.redirect('/login');
    }
};

function isAllowedGoogleEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }
    const raw = (process.env.GOOGLE_ALLOWED_DOMAIN || 'make-tronics.com').trim().toLowerCase();
    const domain = raw.replace(/^@/, '');
    return email.toLowerCase().endsWith(`@${domain}`);
}

function displayNameFromEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return (email || '').trim() || 'User';
    }
    const local = email.split('@')[0];
    return local
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

function getSessionUser(req) {
    let email = ((req.session && req.session.userEmail) || '').trim().toLowerCase();
    let name = ((req.session && req.session.userName) || '').trim();
    if ((!email || !name) && req.user && req.user.email) {
        email = email || String(req.user.email).trim().toLowerCase();
        name = name || (req.user.displayName && String(req.user.displayName).trim()) || '';
    }
    if (!name && email) {
        name = displayNameFromEmail(email);
    }
    return { email, name };
}

function quotationOwnedBy(quotation, ownerEmail) {
    if (!quotation || !ownerEmail) {
        return false;
    }
    const o = (quotation.ownerEmail || '').trim().toLowerCase();
    return o === ownerEmail.trim().toLowerCase();
}

// Add MongoDB connection
mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// Add Quotation Schema
const quotationSchema = new mongoose.Schema({
    quotationNo: String,
    date: String,
    clientName: String,
    clientCompany: String,
    emailTo: String,
    parts: [{
        partNo: String,
        qty: String,
        dc: String,
        leadTime: String,
        condition: String,
        currency: String,
        pricePerUnit: String,
        otherCharges: String
    }],
    type: String, // 'email' or 'print'
    preparedByName: String,
    preparedByCompany: String,
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    ownerName: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const Quotation = mongoose.model('Quotation', quotationSchema);

// Add Scheduled Email Schema
const scheduledEmailSchema = new mongoose.Schema({
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation' },
    emailTo: String,
    scheduleDateTime: Date,
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    htmlContent: String,
    parts: [{
        partNo: String,
        qty: String,
        dc: String,
        leadTime: String,
        condition: String,
        currency: String,
        pricePerUnit: String,
        otherCharges: String
    }],
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    createdAt: { type: Date, default: Date.now }
});

const ScheduledEmail = mongoose.model('ScheduledEmail', scheduledEmailSchema);

const gmailOAuthSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    refreshToken: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
});
const GmailOAuth = mongoose.model('GmailOAuth', gmailOAuthSchema);

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    if (!process.env.GOOGLE_CALLBACK_URL) {
        console.warn('[Google OAuth] GOOGLE_CALLBACK_URL is not set. Example: https://your-domain/auth/google/callback');
    }
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/auth/google/callback`
            },
            (accessToken, refreshToken, profile, done) => {
                const email =
                    (profile.emails && profile.emails[0] && profile.emails[0].value) || '';
                done(null, { email, refreshToken: refreshToken || '', profile });
            }
        )
    );
}

passport.serializeUser((user, done) => {
    const email = (user.email || '').trim().toLowerCase();
    const displayName =
        (user.profile && user.profile.displayName) ||
        user.displayName ||
        displayNameFromEmail(email);
    done(null, { email, displayName: (displayName || '').trim() });
});
passport.deserializeUser((user, done) => {
    done(null, user || {});
});

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    const errMap = {
        google: 'Google sign-in failed. Try again or use email and password.',
        forbidden: 'This Google account is not allowed for this app.',
        noconfig: 'Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server environment.'
    };
    const error = errMap[req.query.error] || null;
    res.render('login', { error });
});

app.get('/auth/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.redirect('/login?error=noconfig');
    }
    passport.authenticate('google', {
        scope: ['profile', 'email', 'https://mail.google.com/'],
        accessType: 'offline',
        prompt: 'consent'
    })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.redirect('/login?error=noconfig');
    }
    passport.authenticate('google', (err, user, info) => {
        if (err || !user) {
            return res.redirect('/login?error=google');
        }
        req.logIn(user, async (loginErr) => {
            if (loginErr) {
                console.error(loginErr);
                return res.redirect('/login?error=google');
            }
            try {
                const emailRaw = user.email || '';
                if (!isAllowedGoogleEmail(emailRaw)) {
                    req.logout((logoutErr) => {
                        if (logoutErr) {
                            console.error(logoutErr);
                        }
                    });
                    return res.redirect('/login?error=forbidden');
                }
                const emailNorm = String(emailRaw).trim().toLowerCase();
                const displayName =
                    (user.profile && user.profile.displayName) ||
                    displayNameFromEmail(emailNorm);
                req.session.authenticated = true;
                req.session.userEmail = emailNorm;
                req.session.userName = (displayName || '').trim() || displayNameFromEmail(emailNorm);

                const refreshToken = typeof user.refreshToken === 'string' ? user.refreshToken : '';
                const existing = await GmailOAuth.findOne({ email: emailNorm });
                const tokenToStore = refreshToken || (existing && existing.refreshToken) || '';
                if (!tokenToStore) {
                    console.warn(
                        '[Google OAuth] No refresh token received. Revoke app access in Google Account and sign in again with consent.'
                    );
                }
                await GmailOAuth.findOneAndUpdate(
                    { email: emailNorm },
                    {
                        email: emailNorm,
                        ...(tokenToStore ? { refreshToken: tokenToStore } : {}),
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
                res.redirect('/create-quotation');
            } catch (e) {
                console.error(e);
                res.redirect('/login?error=google');
            }
        });
    })(req, res, next);
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'manage@make-tronics.com' && password === 'admin112') {
        const emailNorm = String(email).trim().toLowerCase();
        req.session.authenticated = true;
        req.session.userEmail = emailNorm;
        req.session.userName = displayNameFromEmail(emailNorm);
        res.redirect('/create-quotation');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

app.get(
    '/api/me',
    authenticateUser,
    (req, res) => {
        res.json(getSessionUser(req));
    }
);

app.get('/create-quotation', authenticateUser, (req, res) => {
    res.sendFile(path.join(__dirname, 'templates/create-quotation.html'));
});

app.post('/generate-invoice', authenticateUser, async (req, res) => {
    try {
        const quotationData = req.body;
        const owner = getSessionUser(req);
        if (!owner.email) {
            return res.status(401).json({ error: 'Sign in again to continue.' });
        }

        // Save quotation to database
        const quotation = new Quotation({
            ...quotationData,
            type: quotationData.action,
            ownerEmail: owner.email,
            ownerName: owner.name,
            preparedByName: owner.name
        });
        await quotation.save();

        // Create HTML content
        const template = fs.readFileSync(
            quotationData.action === 'email' 
                ? path.join(__dirname, 'templates/email-template.html')
                : path.join(__dirname, 'templates/index.html'), 
            'utf8'
        );
        
        // Create table rows for parts
        const partsRows = quotationData.parts.map(part => `
            <tr>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.partNo}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff;" text-align: center;>${part.qty}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff;" text-align: center;>${part.dc}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff;" text-align: center;>${part.currency} ${part.pricePerUnit}</td>
            </tr>
        `).join('');
        // Add Maketronics Assurance row after all parts
        const assuranceRow = `
            <tr>
                <td colspan="3" style="border: 1px solid #0300ff; padding: 8px; color: #003399; font-size: 12px; text-align: center;">
                    <strong>Maketronics Assurance (QC+ Report)—<span style=\"color:rgb(245, 17, 17);\">Optional*</span></strong><br>
                    <span style="font-size: 10px; color: #4A4A4A;">Recommended for all aged or open-tray components. Detailed inspection report will be shared prior to shipment for customer validation.</span>
                </td>
                <td style="border: 1px solid #0300ff; padding: 8px; color: #003399; font-size: 16px; font-weight: bold; text-align: center;">
                    $120
                </td>
            </tr>`;
        // Replace placeholders with actual data
        let html = template
            .replace('[Number]', quotationData.quotationNo)
            .replace('[Date]', quotationData.date)
            .replace('[ClientName]', quotationData.clientName)
            .replace('[CompanyName]', quotationData.clientCompany)
            .replace('[PreparedByName]', owner.name)
            .replace('<!-- Parts rows will be inserted here -->', partsRows + assuranceRow);

        // Add additional information section
        const additionalInfo = `
            <tr>
                <td style="padding: 0 10px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                        ${quotationData.parts.map(part => `
                        <tr>
                            <td>
                                <p style="color: #0300ff; font-size:12px; margin: 5px 0;"><strong>Part Number: ${part.partNo}</strong></p>
                                <ul style="list-style-type: disc; padding-left: 20px; margin: -3px 0;">
                                    <li style="color: #0300ff; font-size:10px;"><strong>Lead Time:</strong> ${part.leadTime}</li>
                                    <li style="color: #0300ff; font-size:10px;"><strong>Conditions:</strong> ${part.condition}</li>
                                    <li style="color: #0300ff; font-size:10px;"><strong>Other Charges:</strong> ${part.otherCharges}</li>
                                </ul>
                            </td>
                        </tr>
                        `).join('')}
                    </table>
                </td>
            </tr>
        `;
        
        html = html.replace('<!-- Additional Information Section will be inserted here -->', additionalInfo);
        
        if (req.body.action === 'email') {
            try {
                await sendEmail(quotationData.clientName, quotationData.emailTo, null, html, quotationData.parts, owner.email);
                res.json({ success: true, message: 'Quotation sent to email successfully!' });
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: 'Error sending email' });
            }
        } else {
            // Generate PDF for print action
            const options = {
                format: 'A4',
                border: {
                    top: "0.5in",
                    right: "0.5in",
                    bottom: "0.5in",
                    left: "0.5in"
                }
            };
            
            pdf.create(html, options).toBuffer((err, buffer) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Error generating PDF' });
                }
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename=quotation.pdf');
                res.send(buffer);
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

function createLegacySmtpTransport() {
    const user = (process.env.SMTP_USER || '').trim();
    const pass = (process.env.SMTP_PASS || '').trim();
    const host = (process.env.SMTP_HOST || '').trim().toLowerCase();

    if (!user || !pass) {
        return null;
    }

    const smtpDebug =
        process.env.SMTP_DEBUG === '1' ||
        process.env.SMTP_DEBUG === 'true';

    const useGmailPreset = !host || host === 'smtp.gmail.com';

    if (useGmailPreset) {
        return {
            transporter: nodemailer.createTransport({
                service: 'Gmail',
                auth: { user, pass },
                debug: smtpDebug,
                logger: smtpDebug
            }),
            fromAddress: user
        };
    }

    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpSecure =
        process.env.SMTP_SECURE === 'true' ||
        String(process.env.SMTP_SECURE) === '1' ||
        smtpPort === 465;

    return {
        transporter: nodemailer.createTransport({
            host,
            port: smtpPort,
            secure: smtpSecure,
            auth: { user, pass },
            debug: smtpDebug,
            logger: smtpDebug
        }),
        fromAddress: user
    };
}

async function getMailTransportAndFrom(senderEmail) {
    const smtpDebug =
        process.env.SMTP_DEBUG === '1' ||
        process.env.SMTP_DEBUG === 'true';

    const fromNorm = (senderEmail || '').trim().toLowerCase();
    if (!fromNorm) {
        throw new Error('Sender email is required to send mail.');
    }

    const doc = await GmailOAuth.findOne({ email: fromNorm });
    if (
        doc &&
        doc.refreshToken &&
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET
    ) {
        return {
            transporter: nodemailer.createTransport({
                service: 'Gmail',
                auth: {
                    type: 'OAuth2',
                    user: doc.email,
                    clientId: process.env.GOOGLE_CLIENT_ID.trim(),
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
                    refreshToken: doc.refreshToken.trim()
                },
                debug: smtpDebug,
                logger: smtpDebug
            }),
            fromAddress: doc.email
        };
    }

    const legacy = createLegacySmtpTransport();
    const smtpUserNorm = (process.env.SMTP_USER || '').trim().toLowerCase();
    if (legacy && smtpUserNorm === fromNorm) {
        return legacy;
    }

    throw new Error(
        `No mail credentials for ${fromNorm}. Sign in with Google using this email (to store OAuth), or set SMTP_USER and SMTP_PASS to this same address.`
    );
}

function logSmtpEauthHint(err) {
    if (err && err.code === 'EAUTH') {
        console.error(
            '[SMTP] Google rejected the username/password (EAUTH). Checklist: ' +
            '(1) Account must use a 16-character App Password, not your normal login password. ' +
            '(2) Turn on 2-Step Verification for that Google account, then create a new App Password (Mail). ' +
            '(3) In .env use SMTP_USER=full@email.com and SMTP_PASS with no spaces; wrap in quotes if the password contains #. ' +
            '(4) Google Workspace: admin must allow App Passwords / SMTP for this user. ' +
            '(5) Set SMTP_DEBUG=1 temporarily to see SMTP conversation in logs.'
        );
    }
}

// Updated email sending function (Gmail OAuth or SMTP for the logged-in sender only)
async function sendEmail(clientName, toEmail, pdfBuffer, htmlContent, parts, senderEmail) {
    let transporter;
    let fromAddress;
    try {
        const mail = await getMailTransportAndFrom(senderEmail);
        transporter = mail.transporter;
        fromAddress = mail.fromAddress;
    } catch (e) {
        console.error(e);
        throw e;
    }

    let subject = `Quotation from Maketronics | ${clientName}`;
    if (parts && parts.length === 1) {
        subject = `Quotation from Maketronics | ${parts[0].partNo} | ${clientName}`;
    }

    const mailOptions = {
        from: fromAddress,
        to: toEmail,
        subject: subject,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (err) {
        logSmtpEauthHint(err);
        throw err;
    }
}

// Add new route to view quotation history
app.get('/quotation-history', authenticateUser, async (req, res) => {
    try {
        const owner = getSessionUser(req);
        if (!owner.email) {
            return res.redirect('/login');
        }
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const quotations = await Quotation.find({
            ownerEmail: owner.email,
            createdAt: { $gte: since }
        }).sort({ createdAt: -1 });
        res.render('quotation-history', { quotations, viewerEmail: owner.email });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching quotation history' });
    }
});

// View quotation details
app.get('/quotation/:id', authenticateUser, async (req, res) => {
    try {
        const quotation = await Quotation.findById(req.params.id);
        if (!quotation) {
            return res.status(404).send('Quotation not found');
        }
        if (!quotationOwnedBy(quotation, getSessionUser(req).email)) {
            return res.status(404).send('Quotation not found');
        }
        res.render('quotation-detail', { quotation });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching quotation details' });
    }
});

// Print specific quotation
app.get('/quotation/:id/print', authenticateUser, async (req, res) => {
    try {
        const quotation = await Quotation.findById(req.params.id);
        if (!quotation) {
            return res.status(404).send('Quotation not found');
        }
        if (!quotationOwnedBy(quotation, getSessionUser(req).email)) {
            return res.status(404).send('Quotation not found');
        }

        // Read the template file
        const template = fs.readFileSync(path.join(__dirname, 'templates/index.html'), 'utf8');
        
        // Create table rows for parts
        const partsRows = quotation.parts.map(part => `
            <tr>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.partNo}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.qty}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.dc}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.currency} ${part.pricePerUnit}</td>
            </tr>
        `).join('');
        
        // Replace placeholders with actual data
        let html = template
            .replace('[Number]', quotation.quotationNo)
            .replace('[Date]', quotation.date)
            .replace('[ClientName]', quotation.clientName)
            .replace('[CompanyName]', quotation.clientCompany)
            .replace('[PreparedByName]', quotation.preparedByName)
            .replace('<!-- Parts rows will be inserted here -->', partsRows);

        // Generate PDF
        const options = {
            format: 'A4',
            border: {
                top: "0.5in",
                right: "0.5in",
                bottom: "0.5in",
                left: "0.5in"
            }
        };
        
        pdf.create(html, options).toBuffer((err, buffer) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Error generating PDF' });
            }
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=quotation.pdf');
            res.send(buffer);
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error generating PDF' });
    }
});

// Add route for scheduling emails
app.post('/schedule-email', authenticateUser, async (req, res) => {
    try {
        const quotationData = req.body;
        const owner = getSessionUser(req);
        if (!owner.email) {
            return res.status(401).json({ error: 'Sign in again to continue.' });
        }

        // Save quotation to database
        const quotation = new Quotation({
            ...quotationData,
            type: 'scheduled_email',
            ownerEmail: owner.email,
            ownerName: owner.name,
            preparedByName: owner.name
        });
        await quotation.save();

        // Create HTML content
        const template = fs.readFileSync(
            path.join(__dirname, 'templates/email-template.html'), 
            'utf8'
        );
        
        // Create table rows for parts
        const partsRows = quotationData.parts.map(part => `
            <tr>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.partNo}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.qty}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.dc}</td>
                <td style="padding: 12px; border: 1px solid #0300ff; font-size: 13px; color: #0300ff; text-align: center;">${part.currency} ${part.pricePerUnit}</td>
            </tr>
        `).join('');
        
        // Replace placeholders with actual data
        let html = template
            .replace('[Number]', quotationData.quotationNo)
            .replace('[Date]', quotationData.date)
            .replace('[ClientName]', quotationData.clientName)
            .replace('[CompanyName]', quotationData.clientCompany)
            .replace('[PreparedByName]', owner.name)
            .replace('<!-- Parts rows will be inserted here -->', partsRows);

        // Add additional information section
        const additionalInfo = `
            <tr>
                <td style="padding: 0 10px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                        ${quotationData.parts.map(part => `
                        <tr>
                            <td>
                                <p style="color: #0300ff; font-size:12px; margin: 5px 0;"><strong>Part Number: ${part.partNo}</strong></p>
                                <ul style="list-style-type: disc; padding-left: 20px; margin: -3px 0;">
                                    <li style="color: #0300ff; font-size:10px;"><strong>Lead Time:</strong> ${part.leadTime}</li>
                                    <li style="color: #0300ff; font-size:10px;"><strong>Conditions:</strong> ${part.condition}</li>
                                    <li style="color: #0300ff; font-size:10px;"><strong>Other Charges:</strong> ${part.otherCharges}</li>
                                </ul>
                            </td>
                        </tr>
                        `).join('')}
                    </table>
                </td>
            </tr>
        `;
        
        html = html.replace('<!-- Additional Information Section will be inserted here -->', additionalInfo);

        // Save scheduled email to database
        const scheduledEmail = new ScheduledEmail({
            quotationId: quotation._id,
            emailTo: quotationData.emailTo,
            scheduleDateTime: new Date(quotationData.scheduleDateTime),
            htmlContent: html,
            parts: quotationData.parts,
            ownerEmail: owner.email
        });
        await scheduledEmail.save();

        res.json({ success: true, message: 'Email scheduled successfully! It will be sent at the specified time.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Cron job to check for scheduled emails every minute
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        const scheduledEmails = await ScheduledEmail.find({
            status: 'pending',
            scheduleDateTime: { $lte: now }
        }).populate('quotationId');

        for (const scheduledEmail of scheduledEmails) {
            try {
                const senderEmail =
                    (scheduledEmail.ownerEmail ||
                        (scheduledEmail.quotationId && scheduledEmail.quotationId.ownerEmail) ||
                        '').trim().toLowerCase();
                if (!senderEmail) {
                    throw new Error('Scheduled email has no ownerEmail');
                }
                await sendEmail(
                    scheduledEmail.quotationId.clientName,
                    scheduledEmail.emailTo,
                    null,
                    scheduledEmail.htmlContent,
                    scheduledEmail.parts,
                    senderEmail
                );
                
                // Update status to sent
                await ScheduledEmail.findByIdAndUpdate(scheduledEmail._id, { status: 'sent' });
                console.log(`Scheduled email sent successfully to ${scheduledEmail.emailTo}`);
            } catch (error) {
                console.error(`Failed to send scheduled email to ${scheduledEmail.emailTo}:`, error);
                // Update status to failed
                await ScheduledEmail.findByIdAndUpdate(scheduledEmail._id, { status: 'failed' });
            }
        }
    } catch (error) {
        console.error('Error in scheduled email cron job:', error);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        console.log('[Mail] Gmail OAuth configured — sending uses refresh token after a Google sign-in.');
    }
    const u = (process.env.SMTP_USER || '').trim();
    const p = (process.env.SMTP_PASS || '').trim();
    if (u && p) {
        const masked = u.includes('@')
            ? `${u.split('@')[0].slice(0, 2)}***@${u.split('@')[1]}`
            : `${u.slice(0, 2)}***`;
        console.log(`[Mail] SMTP fallback available for ${masked}`);
    } else if (!process.env.GOOGLE_CLIENT_ID) {
        console.warn('[Mail] No Gmail OAuth and no SMTP_USER/SMTP_PASS — outbound email will fail until one is configured.');
    }
}); 