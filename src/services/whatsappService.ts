import axios from "axios";

export const sendWhatsAppReceipt = async (
  phone: string, 
  message: string, 
  instanceId?: string | null, 
  token?: string | null
) => {
  try {
    // Priority: Admin ke apne credentials -> nahi mile toh .env ke default credentials
    const finalInstanceId = instanceId || process.env.WHATSAPP_INSTANCE_ID;
    const finalToken = token || process.env.WHATSAPP_TOKEN;

    if (!finalInstanceId || !finalToken) {
      console.log("WhatsApp credentials missing (No Admin DB config & No .env)");
      return false;
    }

    const response = await axios.post(`https://api.ultramsg.com/${finalInstanceId}/messages/chat`, {
      token: finalToken,
      to: phone,
      body: message
    });

    console.log("WhatsApp sent successfully:", response.data);
    return true;
  } catch (error: any) {
    console.error("WhatsApp Error:", error.response?.data || error.message);
    return false;
  }
};