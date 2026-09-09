import axios from "axios";

export const sendWhatsAppReceipt = async (
  phone: string, 
  message: string, 
  instanceId?: string | null, 
  token?: string | null
): Promise<boolean> => {
  try {
    const finalInstanceId = instanceId || process.env.WHATSAPP_INSTANCE_ID;
    const finalToken = token || process.env.WHATSAPP_TOKEN;

    if (!finalInstanceId || !finalToken) {
      console.log("WhatsApp credentials missing (No Admin DB config & No .env)");
      return false;
    }

    // Phone number sanitization: Sirf numbers rakhega (e.g., +91 98765-43210 -> 919876543210)
    const sanitizedPhone = phone.replace(/\D/g, "");

    const response = await axios.post(
      `https://api.ultramsg.com/${finalInstanceId}/messages/chat`,
      {
        token: finalToken,
        to: sanitizedPhone,
        body: message
      },
      { timeout: 10000 } // 10 seconds timeout
    );

    console.log("WhatsApp sent successfully:", response.data);
    return true;
  } catch (error: any) {
    console.error("WhatsApp Error:", error.response?.data || error.message);
    return false;
  }
};