require('dotenv').config();
const express = require('express');
const session = require('express-session');
const hbs = require('hbs');
const path = require('path');
const nodemailer = require('nodemailer');
const pdf = require('html-pdf');
const bodyParser = require('body-parser');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));
app.use('/assets', express.static(path.join(__dirname, 'templates/assets')));

// View engine setup
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'templates'));
hbs.registerPartials(path.join(__dirname, 'templates/layouts'));

// Authentication middleware
const authenticateUser = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
};

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
    createdAt: { type: Date, default: Date.now }
});

const Quotation = mongoose.model('Quotation', quotationSchema);

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'manage@make-tronics.com' && password === 'admin112') {
        req.session.authenticated = true;
        res.redirect('/create-quotation');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

app.get('/create-quotation', authenticateUser, (req, res) => {
    res.sendFile(path.join(__dirname, 'templates/create-quotation.html'));
});

app.post('/generate-invoice', authenticateUser, async (req, res) => {
    try {
        const quotationData = req.body;
        
        // Save quotation to database
        const quotation = new Quotation({
            ...quotationData,
            type: quotationData.action
        });
        await quotation.save();

        // Read the template file
        const template = fs.readFileSync(path.join(__dirname, 'templates/index.html'), 'utf8');
        
        // Create table rows for parts
        const partsRows = quotationData.parts.map(part => `
            <tr>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.partNo}</td>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.qty}</td>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.dc}</td>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.leadTime}</td>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.condition}</td>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.currency} ${part.pricePerUnit}</td>
                <td style="padding: 12px; border: 1px solid #003399; font-size: 13px; color: #4A4A4A;">${part.currency} ${part.otherCharges}</td>
            </tr>
        `).join('');
        
        // Replace placeholders with actual data
        let html = template
            .replace('[Number]', quotationData.quotationNo)
            .replace('[Date]', quotationData.date)
            .replace('[ClientName]', quotationData.clientName)
            .replace('[CompanyName]', quotationData.clientCompany)
            .replace('[PreparedByName]', quotationData.preparedByName)
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
        
        pdf.create(html, options).toBuffer(async (err, buffer) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Error generating PDF' });
            }
            
            if (req.body.action === 'email') {
                try {
                    await sendEmail(quotationData.clientName, quotationData.emailTo, buffer, html);
                    res.json({ success: true, message: 'Quotation sent to email successfully!' });
                } catch (error) {
                    console.error(error);
                    res.status(500).json({ error: 'Error sending email' });
                }
            } else {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename=quotation.pdf');
                res.send(buffer);
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Email sending function
async function sendEmail(clientName, toEmail, pdfBuffer, htmlContent) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: 'quotation@make-tronics.com',
        to: toEmail,
        cc: 'sales@make-tronics.com',
        subject: `Quotation from Maketronics for ${clientName}`,
        html: htmlContent,
        attachments: [{
            filename: 'quotation.pdf',
            content: pdfBuffer
        }]
    };

    await transporter.sendMail(mailOptions);
}

// Add new route to view quotation history
app.get('/quotation-history', authenticateUser, async (req, res) => {
    try {
        const quotations = await Quotation.find().sort({ createdAt: -1 });
        res.render('quotation-history', { quotations });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching quotation history' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 