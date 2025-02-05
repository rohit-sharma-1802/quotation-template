router.post('/send-quotation', async (req, res) => {
  try {
    const {
      quotationNumber,
      quotationDate,
      preparedBy,
      // ... other fields ...
      leadTime,
      conditions,
      otherCharges
    } = req.body;

    // Create HTML content
    const htmlContent = `
      <html>
        <head>
          <style>
            /* Add your CSS styles here */
          </style>
        </head>
        <body>
          <h2>Quotation ${quotationNumber}</h2>
          <p>Date: ${quotationDate}</p>
          <p>Prepared By: ${preparedBy}</p>
          <!-- Add your quotation table and other content here -->
          <div class="additional-info">
            <h4>Additional Information</h4>
            <ul>
              <li>Lead Time: ${leadTime}</li>
              <li>Conditions: ${conditions}</li>
              <li>Other Charges: ${otherCharges}</li>
            </ul>
          </div>
        </body>
      </html>
    `;

    // Configure email
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: req.body.emailTo,
      subject: `Quotation ${quotationNumber}`,
      html: htmlContent
    };

    // Send email
    await transporter.sendMail(mailOptions);
    
    res.status(200).json({ message: 'Quotation sent successfully' });
  } catch (error) {
    console.error('Error sending quotation:', error);
    res.status(500).json({ error: 'Failed to send quotation' });
  }
}); 