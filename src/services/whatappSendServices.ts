import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";

export const generateAndSendUserReportPDF = async (user: any, tokens: any[], accounts: any[], adminCredentials: { instanceId?: string, token?: string, phone: string }) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const filePath = path.join(__dirname, `../../temp_report_${user.id}.pdf`);
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // 🎨 PDF Design & Header
      doc.fontSize(20).text("BRICKS & MATERIAL ADMIN SYSTEM", { align: "center" });
      doc.fontSize(12).text("User Account Statement & Token Report", { align: "center" });
      doc.moveDown();

      doc.fontSize(14).text(`User / Dealer Name: ${user.name}`);
      doc.text(`Email: ${user.email}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      doc.moveDown();

      // Material Balances
      doc.fontSize(14).text("--- Material Accounts ---", { underline: true });
      accounts.forEach((acc) => {
        doc.fontSize(12).text(`Material: ${acc.materialType.toUpperCase()} | Total: ${acc.totalTons} Tons | Used: ${acc.usedTons} Tons | Remaining: ${acc.remainingTons} Tons`);
      });
      doc.moveDown();

      // Tokens Section
      doc.fontSize(14).text("--- Token History (Pending & Updated) ---", { underline: true });
      tokens.forEach((t, index) => {
        doc.fontSize(10).text(`${index + 1}. Customer: ${t.customerName} | Truck: ${t.truckNumber || 'N/A'} | Material: ${t.materialType} | Weight: ${t.weight || 0} Tons | Status: ${t.status.toUpperCase()} | Amount: ₹${t.totalAmount}`);
      });

      doc.end();

      stream.on("finish", async () => {
        try {
          // Send via UltraMsg Document API
          const finalInstanceId = adminCredentials.instanceId || process.env.WHATSAPP_INSTANCE_ID;
          const finalToken = adminCredentials.token || process.env.WHATSAPP_TOKEN;

          const form = new FormData();
          form.append("token", finalToken);
          form.append("to", adminCredentials.phone);
          form.append("document", fs.createReadStream(filePath));
          form.append("filename", `Report_${user.name}.pdf`);
          form.append("caption", `📄 Hello ${user.name}, here is your complete token and material report.`);

          await axios.post(`https://api.ultramsg.com/${finalInstanceId}/messages/document`, form, {
            headers: form.getHeaders(),
          });

          // Delete temporary file
          fs.unlinkSync(filePath);
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