require('dotenv').config();
const express = require('express');
const session = require('express-session');
const hbs = require('hbs');
const path = require('path');
const nodemailer = require('nodemailer');
const pdf = require('html-pdf');
const bodyParser = require('body-parser');

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
        res.redirect('/invoice-form');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

app.get('/invoice-form', authenticateUser, (req, res) => {
    res.render('invoice-form');
});

app.post('/generate-invoice', authenticateUser, async (req, res) => {
    const invoiceData = req.body;
    
    // Generate PDF
    const html = await generateInvoiceHTML(invoiceData);
    
    pdf.create(html).toBuffer((err, buffer) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error generating PDF');
        }
        
        if (req.body.action === 'email') {
            // Send email with PDF attachment
            sendEmail(invoiceData.email, buffer, html);
            res.send('Invoice sent to email successfully!');
        } else {
            // Send PDF for printing
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');
            res.send(buffer);
        }
    });
});

// Email sending function
async function sendEmail(toEmail, pdfBuffer, htmlContent) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: toEmail,
        subject: 'Invoice',
        html: htmlContent,
        attachments: [{
            filename: 'invoice.pdf',
            content: pdfBuffer
        }]
    };

    await transporter.sendMail(mailOptions);
}

// Generate invoice HTML
function generateInvoiceHTML(data) {
    // You'll need to implement this function to generate HTML for the invoice
    // using the data from the form
    return `
        <html>
            <body>
                <h1>Invoice</h1>
                <!-- Add your invoice template here -->
            </body>
        </html>
    `;
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 