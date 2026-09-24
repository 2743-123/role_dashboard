import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
// Ye dhyaan rakhein ki whatsappService ka path sahi ho
import { sendAdminMessage, sendAdminDocument } from "./whatsappService"; 

// ⭐ 1. SEND NORMAL TEXT RECEIPT
export const sendWhatsAppReceipt = async (
  phone: string, 
  message: string, 
  adminId: string | number
): Promise<boolean> => {
  try {
    if (!adminId) {
      console.log("❌ WhatsApp Error: adminId is missing.");
      return false;
    }
    return await sendAdminMessage(adminId, phone, message);
  } catch (error: any) {
    console.error("WhatsApp Error:", error.message);
    return false;
  }
};

// ⭐ 2. GENERATE AND SEND PDF REPORT
export const generateAndSendUserReportPDF = async (
  user: any, 
  tokens: any[], 
  accounts: any[], 
  adminCredentials: { adminId: string | number, phone: string }
) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const filePath = path.join(__dirname, `../../temp_report_${user.id}.pdf`);
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // PDF Design 
      doc.fontSize(20).text("BRICKS & MATERIAL ADMIN SYSTEM", { align: "center" });
      doc.fontSize(12).text("User Account Statement & Token Report", { align: "center" });
      doc.moveDown();

      doc.fontSize(14).text(`User / Dealer Name: ${user.name}`);
      doc.text(`Email: ${user.email}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      doc.moveDown();

      doc.fontSize(14).text("--- Material Accounts ---", { underline: true });
      accounts.forEach((acc) => {
        doc.fontSize(12).text(`Material: ${acc.materialType.toUpperCase()} | Total: ${acc.totalTons} Tons | Used: ${acc.usedTons} Tons | Remaining: ${acc.remainingTons} Tons`);
      });
      doc.moveDown();

      doc.fontSize(14).text("--- Token History (Pending & Updated) ---", { underline: true });
      tokens.forEach((t, index) => {
        doc.fontSize(10).text(`${index + 1}. Customer: ${t.customerName} | Truck: ${t.truckNumber || 'N/A'} | Material: ${t.materialType} | Weight: ${t.weight || 0} Tons | Status: ${t.status.toUpperCase()} | Amount: ₹${t.totalAmount}`);
      });

      doc.end();

      stream.on("finish", async () => {
        try {
          const caption = `📄 Hello ${user.name}, here is your complete token and material report.`;
          
          await sendAdminDocument(
            adminCredentials.adminId, 
            adminCredentials.phone, 
            filePath, 
            caption
          );

          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          resolve(true);
        } catch (err) {
          console.error("PDF WhatsApp Send Error:", err);
          reject(err);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
};