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
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 3600000 // 1 hour in milliseconds
    }
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
    createdAt: { type: Date, default: Date.now }
});

const ScheduledEmail = mongoose.model('ScheduledEmail', scheduledEmailSchema);

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
            .replace('[PreparedByName]', quotationData.preparedByName)
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
                await sendEmail(quotationData.clientName, quotationData.emailTo, null, html, quotationData.parts);
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

// Updated email sending function
async function sendEmail(clientName, toEmail, pdfBuffer, htmlContent, parts) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        }
    });

    let subject = `Quotation from Maketronics | ${clientName}`;
    if (parts && parts.length === 1) {
        subject = `Quotation from Maketronics | ${parts[0].partNo} | ${clientName}`;
    }

    const mailOptions = {
        from: 'sales@make-tronics.com',
        to: toEmail,
        cc: 'sales@make-tronics.com',
        subject: subject,
        html: htmlContent
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

// View quotation details
app.get('/quotation/:id', authenticateUser, async (req, res) => {
    try {
        const quotation = await Quotation.findById(req.params.id);
        if (!quotation) {
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
        
        // Save quotation to database
        const quotation = new Quotation({
            ...quotationData,
            type: 'scheduled_email'
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
            .replace('[PreparedByName]', quotationData.preparedByName)
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
            parts: quotationData.parts
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
                await sendEmail(
                    scheduledEmail.quotationId.clientName,
                    scheduledEmail.emailTo,
                    null,
                    scheduledEmail.htmlContent,
                    scheduledEmail.parts
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
}); 