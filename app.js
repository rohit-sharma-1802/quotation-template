require('dotenv').config();
const express = require('express');
const session = require('express-session');
const hbs = require('hbs');
const path = require('path');
const nodemailer = require('nodemailer');
const pdf = require('html-pdf');
const bodyParser = require('body-parser');
const fs = require('fs');

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
    const quotationData = req.body;
    
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
            return res.status(500).send('Error generating PDF');
        }
        
        if (req.body.action === 'email') {
            // Send email with PDF attachment
            sendEmail(quotationData.clientName, quotationData.emailTo, buffer, html);
            res.send('Quotation sent to email successfully!');
        } else {
            // Send PDF for printing
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=quotation.pdf');
            res.send(buffer);
        }
    });
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
        from: 'rohitsharmatech@gmail.com',
        to: toEmail,
        cc: 'dev-rohit@make-tronics.com',
        subject: `Quotation from Maketronics for ${clientName}`,
        html: htmlContent,
        attachments: [{
            filename: 'quotation.pdf',
            content: pdfBuffer
        }]
    };

    await transporter.sendMail(mailOptions);
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 