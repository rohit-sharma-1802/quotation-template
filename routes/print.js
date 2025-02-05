router.get('/print', (req, res) => {
    // Sample data - replace with your actual data
    const data = {
        companyName: "Your Company Name",
        companyAddress: "123 Business Street, City, Country",
        documentTitle: "Invoice",
        documentNumber: "INV-2024-001",
        date: new Date(),
        customer: {
            name: "John Doe",
            email: "john@example.com",
            phone: "+1 234 567 8900"
        },
        items: [
            {
                name: "Product 1",
                quantity: 2,
                price: 100,
                total: 200
            },
            {
                name: "Product 2",
                quantity: 1,
                price: 150,
                total: 150
            }
        ]
    };

    res.render('print-template', data);
}); 