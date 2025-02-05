function generateQuotationNumber() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `MK-${year}-${random}`;
}

function setCurrentDate() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('quotationDate').value = today;
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('quotationNumber').value = generateQuotationNumber();
  setCurrentDate();
}); 