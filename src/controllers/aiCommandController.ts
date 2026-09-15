import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { userService } from "../services/ai/userService";
import { balanceService } from "../services/ai/balanceService";
import { tokenService } from "../services/ai/tokenService";
import { bedashService } from "../services/ai/bedashService";
import { paymentService } from "../services/ai/paymentService";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const handleAiCommand = async (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    const currentUser = (req as any).user;

    if (!command) return res.status(400).json({ msg: "❌ Command text is required" });

    const prompt = `
      You are an AI Admin Assistant for Bricks & Material Dashboard.
      Extract intent and parameters from the user's natural language command into this strict JSON.
      * IMPORTANT: If the user refers to themselves ("my", "mera", "mujhe", "meri", "mere"), leave targetUserName empty! The system will auto-detect them.
      
      Intents:
      1. "CREATE_USER": Params: name, phone, role.
      2. "DELETE_USER": Params: targetUserName.
      3. "ADD_BALANCE": Params: targetUserName, flyashAmount, bedashAmount, paymentMode.
      4. "GET_BALANCE": Params: targetUserName.
      5. "CREATE_TOKEN": Params: targetUserName, customerName, customerPhone, truckNumber, materialType.
      6. "BEDASH_MESSAGE": Params: action (add/confirm), targetUserName, date (optional YYYY-MM-DD).
      7. "CHECK_PAYMENT_HISTORY": Params: targetUserName.
      8. "CHAT": Casual talk. Params: replyMessage.
      9. "DELETE_TOKEN": Params: targetUserName, customerName.
      10. "UPDATE_TOKEN": Params: targetUserName, customerName, searchDate, searchTruckNumber, searchWeight, newTruckNumber, newWeight, newCommission, newDate.
      11. "REPORT_USERS": List all users.
      12. "REPORT_BALANCE": Get balance analytics. Params: filterType ("latest", "monthly", "highest_stock", "low_balance"), limit (number).
      13. "REPORT_USER_TOKENS": Token count and total money owed for a dealer/user. Params: targetUserName.
      14. "REPORT_CUSTOMER": Customer token dues across all dealers and token statuses. Params: customerName.
      15. "REPORT_BEDASH_MESSAGES": Latest bedash messages. Params: limit (number), sortOrder ("ASC" or "DESC").
      16. "CUSTOMER_PAYMENT": Record payment received from a customer to clear pending/updated tokens. Params: customerName, paymentAmount (number, 0 if specific truck/date given without amount), searchTruckNumber (optional), searchDate (optional YYYY-MM-DD).

      Command: "${command}"

      Format ONLY as valid JSON without markdown:
      {
        "intent": "...",
        "parameters": {
          "name": "", "phone": "", "role": "",
          "targetUserName": "", "customerName": "", "customerPhone": "",
          "flyashAmount": 0, "bedashAmount": 0, "paymentMode": "cash",
          "materialType": "", "action": "", "amount": 0, "reminderPhone": "", "replyMessage": "",
          "searchDate": "", "searchTruckNumber": "", "searchWeight": "",
          "newTruckNumber": "", "newWeight": "", "newCommission": "", "newDate": "",
          "filterType": "", "limit": 0, "date": "", "sortOrder": "",
          "paymentAmount": 0
        }
      }
    `;

    const aiResponse = await ai.models.generateContent({ model: "gemini-3.5-flash-lite", contents: prompt });
    let rawText = aiResponse.text || "{}";
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsedAction;
    try { parsedAction = JSON.parse(rawText); } 
    catch (parseError) { return res.status(400).json({ msg: "🤖 Mujhe command theek se samajh nahi aayi." }); }

    const intent = parsedAction?.intent || "UNKNOWN";
    const params = parsedAction?.parameters || {};
    let targetUserName = params?.targetUserName || "";

    if (currentUser.role === "user") {
      targetUserName = currentUser.name;
    } else {
      const selfIntents = ["GET_BALANCE", "REPORT_USER_TOKENS", "CHECK_PAYMENT_HISTORY", "BEDASH_MESSAGE", "CREATE_TOKEN", "UPDATE_TOKEN", "DELETE_TOKEN"];
      if (!targetUserName && selfIntents.includes(intent)) targetUserName = currentUser.name;
    }

    let response;
    switch (intent) {
      case "CREATE_USER": response = await userService.createUser(params, currentUser); break;
      case "DELETE_USER": response = await userService.deleteUser(targetUserName, currentUser); break;
      case "REPORT_USERS": response = await userService.reportUsers(currentUser); break;
      case "ADD_BALANCE": response = await balanceService.addBalance(params, targetUserName, currentUser); break;
      case "GET_BALANCE": response = await balanceService.getBalance(targetUserName); break;
      case "REPORT_BALANCE": response = await balanceService.reportBalance(params, currentUser); break;
      case "CREATE_TOKEN": response = await tokenService.createToken(params, targetUserName, currentUser); break;
      case "DELETE_TOKEN": response = await tokenService.deleteToken(params, targetUserName, currentUser); break;
      case "UPDATE_TOKEN": response = await tokenService.updateToken(params, targetUserName, currentUser); break;
      case "REPORT_USER_TOKENS": response = await tokenService.reportUserTokens(targetUserName, currentUser); break;
      case "REPORT_CUSTOMER": response = await tokenService.reportCustomer(params, currentUser); break;
      case "BEDASH_MESSAGE": response = await bedashService.bedashMessage(params, targetUserName, currentUser); break;
      case "REPORT_BEDASH_MESSAGES": response = await bedashService.reportBedashMessages(params, currentUser); break;
      case "CHECK_PAYMENT_HISTORY": response = await paymentService.checkPaymentHistory(targetUserName, currentUser); break;
      case "CUSTOMER_PAYMENT": response = await paymentService.customerPayment(params, currentUser); break;
      default: response = { msg: `🤖 Hello **${currentUser.name}**! ${params.replyMessage || "Boliye, kya help karu?"}` };
    }

    return res.json(response);

  } catch (error: any) {
    console.error("🔥 AI Crash Error:", error);
    if (error?.status === 429) return res.status(429).json({ msg: "🤖 Rate Limit! Kripya 1 minute baad try karein." });
    return res.status(500).json({ msg: "Server Error", error: error?.message });
  }
};