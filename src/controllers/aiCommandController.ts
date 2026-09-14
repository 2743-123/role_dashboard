import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";
import bcrypt from "bcryptjs";

// Models
import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { Transaction } from "../models/Transaction";
import { Token } from "../models/Token";
import { BedashMessage } from "../models/bedashMessage";
import { PaymentHistory } from "../models/PaymentHistory";

// AI Configuration
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Repositories
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const transactionRepo = AppDataSource.getRepository(Transaction);
const tokenRepo = AppDataSource.getRepository(Token);
const bedashRepo = AppDataSource.getRepository(BedashMessage);
const paymentRepo = AppDataSource.getRepository(PaymentHistory);

const RATE_PER_TON = 180;

// Helper: Permission Check
const checkPermission = (currentUser: any, targetUser: any) => {
  if (currentUser.role === "superadmin") return true;
  if (currentUser.role === "admin" && targetUser.creator?.id === currentUser.id) return true;
  if (currentUser.role === "user" && targetUser.id === currentUser.id) return true;
  return false;
};

export const handleAiCommand = async (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    const currentUser = (req as any).user;

    if (!command) return res.status(400).json({ msg: "❌ Command text is required" });

    const prompt = `
      You are an AI Admin Assistant for Bricks & Material Dashboard.
      Extract intent and parameters from the user's natural language command into this strict JSON.
      
      Intents:
      1. "CREATE_USER": Params: name, phone, role (default user).
      2. "DELETE_USER": Params: targetUserName.
      3. "ADD_BALANCE": Params: targetUserName, flyashAmount, bedashAmount, paymentMode (default cash).
      4. "GET_BALANCE": Params: targetUserName (optional).
      5. "CREATE_TOKEN": Params: targetUserName, customerName, customerPhone, truckNumber, materialType (flyash/bedash).
      6. "BEDASH_MESSAGE": Params: action (add/confirm), targetUserName, amount, materialType, reminderPhone.
      7. "CHECK_PAYMENT_HISTORY": Params: targetUserName (optional).
      8. "CHAT": Casual talk. Params: replyMessage.
      9. "DELETE_TOKEN": Params: targetUserName (dealer), customerName.
      10. "UPDATE_TOKEN": Params: targetUserName (dealer), customerName. 
          Find existing token using: searchDate, searchTruckNumber, searchWeight. 
          Values to update: newTruckNumber, newWeight, newCommission, newDate (YYYY-MM-DD).

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
          "newTruckNumber": "", "newWeight": "", "newCommission": "", "newDate": ""
        }
      }
    `;

    const aiResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
    });

    let rawText = aiResponse.text || "{}";
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsedAction;
    try {
      parsedAction = JSON.parse(rawText);
    } catch (parseError) {
      return res.status(400).json({ msg: "🤖 Mujhe command theek se samajh nahi aayi." });
    }

    const intent = parsedAction?.intent || "UNKNOWN";
    const params = parsedAction?.parameters || {};
    const targetUserName = params?.targetUserName || "";

    const findUser = async (name: string) => {
      if (!name) return null;
      return await userRepo.createQueryBuilder("user")
        .leftJoinAndSelect("user.creator", "creator")
        .where("user.name ILIKE :name", { name: `%${name}%` })
        .getOne();
    };

    // ============================================
    // 1. CHAT
    // ============================================
    if (intent === "CHAT" || intent === "UNKNOWN") {
      return res.json({ msg: `🤖 ${params.replyMessage || "Boliye, kya help karu?"}` });
    }

    // ============================================
    // 2. CREATE USER 
    // ============================================
    else if (intent === "CREATE_USER") {
      if (!params.name) return res.json({ msg: "🤖 User ka naam batana zaroori hai." });

      const hashedPassword = await bcrypt.hash("password123", 10);
      const newUser = userRepo.create({
        name: params.name,
        role: params.role || "user",
        phone: params.phone || "",
        email: `${params.name.replace(/\s+/g, "").toLowerCase()}@bricks.com`,
        password: hashedPassword,
        isActive: true,
        creator: currentUser
      });
      await userRepo.save(newUser);
      return res.json({ msg: `✅ User '${params.name}' system me add ho gaya hai.` });
    }

    // ============================================
    // 3. DELETE USER 
    // ============================================
    else if (intent === "DELETE_USER") {
      const user = await findUser(targetUserName);
      if (!user) return res.json({ msg: `🤖 '${targetUserName}' naam ka user nahi mila.` });

      if (!checkPermission(currentUser, user)) return res.json({ msg: "🚫 Aap is user ko delete nahi kar sakte." });

      await AppDataSource.manager.transaction(async (manager) => {
        await manager.delete(MaterialAccount, { user: { id: user.id } });
        await manager.delete(Transaction, { user: { id: user.id } });
        await manager.delete(BedashMessage, { user: { id: user.id } });
        await manager.remove(user);
      });
      return res.json({ msg: `🗑️ User '${user.name}' aur uska saara data delete ho gaya hai.` });
    }

    // ============================================
    // 4. ADD BALANCE 
    // ============================================
    else if (intent === "ADD_BALANCE") {
      const user = await findUser(targetUserName);
      if (!user) return res.json({ msg: "🤖 Balance add karne ke liye valid user naam batayein." });
      if (!checkPermission(currentUser, user)) return res.json({ msg: "🚫 Permission Denied." });

      const fAmt = Number(params.flyashAmount) || 0;
      const bAmt = Number(params.bedashAmount) || 0;
      const totalMoney = fAmt + bAmt;

      const fTons = fAmt / RATE_PER_TON;
      const bTons = bAmt / RATE_PER_TON;

      let fAcc = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "flyash" } });
      if (!fAcc) fAcc = accountRepo.create({ user, materialType: "flyash", totalTons: 0, usedTons: 0, remainingTons: 0 });
      fAcc.totalTons += fTons; fAcc.remainingTons += fTons;

      let bAcc = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "bedash" } });
      if (!bAcc) bAcc = accountRepo.create({ user, materialType: "bedash", totalTons: 0, usedTons: 0, remainingTons: 0 });
      bAcc.totalTons += bTons; bAcc.remainingTons += bTons;

      await accountRepo.save([fAcc, bAcc]);

      const transaction = transactionRepo.create({
        user, totalAmount: totalMoney, flyashAmount: fAmt, bedashAmount: bAmt,
        flyashTons: fTons, bedashTons: bTons, paymentMode: params.paymentMode || "cash"
      });
      await transactionRepo.save(transaction);

      const payment = paymentRepo.create({
        user: user,
        admin: { id: currentUser.id } as any,
        amount: totalMoney,
        type: "add_balance",
        details: { flyashAmount: fAmt, bedashAmount: bAmt, flyashTons: fTons, bedashTons: bTons, paymentMode: params.paymentMode || "cash" }
      } as any);
      await paymentRepo.save(payment);

      return res.json({ msg: `✅ ${user.name} ke account me Flyash: ₹${fAmt} aur Bedash: ₹${bAmt} add ho gaye hain.` });
    }

    // ============================================
    // 5. CREATE TOKEN (Smart Swap Logic)
    // ============================================
    else if (intent === "CREATE_TOKEN") {
      let dealerNameInput = targetUserName;
      let customerNameInput = params.customerName || "";

      let user = await findUser(dealerNameInput);
      let finalCustomerName = customerNameInput;

      if (!user && customerNameInput) {
        const checkOtherName = await findUser(customerNameInput);
        if (checkOtherName) {
          user = checkOtherName;
          finalCustomerName = dealerNameInput;
        }
      }

      if (!user) return res.json({ msg: "🤖 System me dealer ka naam nahi mila." });
      if (!checkPermission(currentUser, user)) return res.json({ msg: "🚫 Permission Denied." });

      finalCustomerName = finalCustomerName || "Walk-in";

      const adminUser = user.role === "user" ? user.creator : user;
      const adminId = adminUser?.id;

      const lastToken = await tokenRepo.createQueryBuilder("t")
        .leftJoin("t.user", "u").leftJoin("u.creator", "c")
        .where("t.customerName = :cName", { cName: finalCustomerName })
        .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
        .orderBy("t.id", "DESC").getOne();

      const newToken = tokenRepo.create({
        customerName: finalCustomerName,
        customerPhone: params.customerPhone || null,
        user: user,
        truckNumber: params.truckNumber || null,
        materialType: params.materialType || "flyash",
        weight: 0, commission: 0, totalAmount: 0, paidAmount: 0,
        status: "pending",
        carryForward: lastToken ? Number(lastToken.carryForward || 0) : 0,
      });

      await tokenRepo.save(newToken);
      return res.json({ msg: `✅ Token #${newToken.id} created successfully for Customer: *${newToken.customerName}* (Dealer: *${user.name}*).` });
    }

    // ============================================
    // 6. BEDASH MESSAGE
    // ============================================
    else if (intent === "BEDASH_MESSAGE") {
      const user = await findUser(targetUserName);
      if (!user) return res.json({ msg: "🤖 Kiske liye request banani hai? Naam batayein." });
      if (!checkPermission(currentUser, user)) return res.json({ msg: "🚫 Permission Denied." });

      const action = params.action?.toLowerCase();
      if (action === "add") {
        const newBedash = bedashRepo.create({
          user: user,
          createdBy: { id: currentUser.id } as any,
          materialType: params.materialType || "flyash",
          amount: Number(params.amount) || 0,
          reminderPhone: params.reminderPhone || null,
          status: "pending"
        });
        await bedashRepo.save(newBedash);
        return res.json({ msg: `✅ ${user.name} ke liye request add ho gayi hai.` });
      }
      else if (action === "confirm") {
        const pending = await bedashRepo.findOne({
          where: { user: { id: user.id }, status: "pending" }, order: { id: "DESC" }
        });
        if (!pending) return res.json({ msg: `🤖 Koi pending request nahi mili.` });

        pending.status = "completed";
        await bedashRepo.save(pending);
        return res.json({ msg: `✅ ${user.name} ki request COMPLETED mark ho gayi hai.` });
      }
    }

    // ============================================
    // 7. CHECK PAYMENT HISTORY
    // ============================================
    else if (intent === "CHECK_PAYMENT_HISTORY") {
      let query = paymentRepo.createQueryBuilder("p")
        .leftJoinAndSelect("p.user", "user")
        .leftJoinAndSelect("p.admin", "admin")
        .orderBy("p.createdAt", "DESC").take(3);

      if (currentUser.role === "admin") {
        query = query.where("admin.id = :id OR user.createdBy = :id", { id: currentUser.id });
      } else if (currentUser.role === "user") {
        query = query.where("user.id = :id", { id: currentUser.id });
      }

      if (targetUserName) {
        query = query.andWhere("user.name ILIKE :name", { name: `%${targetUserName}%` });
      }

      const history = await query.getMany();
      if (!history.length) return res.json({ msg: `🤖 Koi payment history nahi mili.` });

      let replyMsg = `🤖 **Recent Payment History:**\n`;
      history.forEach((pay, idx) => {
        const date = new Date(pay.createdAt).toLocaleDateString("en-IN");
        replyMsg += `${idx + 1}. Date: ${date} | User: ${pay.user?.name} | Type: ${pay.type} | Amount: ₹${pay.amount}\n`;
      });
      return res.json({ msg: replyMsg });
    }

    // ============================================
    // 8. GET_BALANCE
    // ============================================
    else if (intent === "GET_BALANCE") {
      const user = await findUser(targetUserName);
      if (!user) return res.json({ msg: "🤖 Kiska balance check karna hai? Naam batayein." });

      const flyash = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "flyash" } });
      const bedash = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "bedash" } });

      return res.json({ msg: `🤖 **${user.name} ka Stock:**\n📦 Flyash: ${flyash?.remainingTons || 0} Tons\n📦 Bedash: ${bedash?.remainingTons || 0} Tons.` });
    }

    // ============================================
    // 9. DELETE TOKEN 
    // ============================================
    else if (intent === "DELETE_TOKEN") {
      let dealerNameInput = targetUserName;
      let customerNameInput = params.customerName || "";

      let user = await findUser(dealerNameInput);
      let finalCustomerName = customerNameInput;

      if (!user && customerNameInput) {
        const checkOtherName = await findUser(customerNameInput);
        if (checkOtherName) {
          user = checkOtherName;
          finalCustomerName = dealerNameInput;
        }
      }

      if (!user) return res.json({ msg: "🤖 System me dealer (User) ka naam nahi mila." });
      if (!finalCustomerName) return res.json({ msg: "🤖 Kripya Customer ka naam bhi batayein jisko delete karna hai." });
      if (!checkPermission(currentUser, user)) return res.json({ msg: "🚫 Permission Denied." });

      const tokenToDelete = await tokenRepo.findOne({
        where: { user: { id: user.id }, customerName: finalCustomerName, status: "pending" },
        order: { id: "DESC" }
      });

      if (!tokenToDelete) {
        return res.json({ msg: `🤖 Dealer *${user.name}* ke account me Customer *${finalCustomerName}* ki koi PENDING token nahi mili.` });
      }

      const deletedId = tokenToDelete.id;
      await tokenRepo.remove(tokenToDelete);

      return res.json({ msg: `✅ Customer *${finalCustomerName}* ki aakhri pending Token (ID: #${deletedId}) successfully delete kar di gayi hai.` });
    }

    // ============================================
    // 10. UPDATE TOKEN (🚀 Auto-Healing Stock & Ledger Logic)
    // ============================================
    else if (intent === "UPDATE_TOKEN") {
      let dealerNameInput = targetUserName;
      let customerNameInput = params.customerName || "";

      let user = await findUser(dealerNameInput);
      let finalCustomerName = customerNameInput;

      if (!user && customerNameInput) {
        const checkOtherName = await findUser(customerNameInput);
        if (checkOtherName) { user = checkOtherName; finalCustomerName = dealerNameInput; }
      }

      if (!user) return res.json({ msg: "🤖 System me dealer ka naam nahi mila." });
      if (!finalCustomerName) return res.json({ msg: "🤖 Kripya Customer ka naam batayein." });
      if (!checkPermission(currentUser, user)) return res.json({ msg: "🚫 Permission Denied." });

      const { searchDate, searchTruckNumber, searchWeight, newTruckNumber, newWeight, newCommission, newDate } = params;

      let query = tokenRepo.createQueryBuilder("t")
        .leftJoinAndSelect("t.user", "u")
        .where("u.id = :userId", { userId: user.id })
        .andWhere("t.customerName = :cName", { cName: finalCustomerName });

      let hasSearchParams = false;
      if (searchTruckNumber) { query = query.andWhere("t.truckNumber ILIKE :sTruck", { sTruck: `%${searchTruckNumber}%` }); hasSearchParams = true; }
      if (searchWeight) { query = query.andWhere("CAST(t.weight AS TEXT) = :sWeight", { sWeight: String(searchWeight) }); hasSearchParams = true; }
      if (searchDate) { query = query.andWhere("CAST(t.updatedAt AS TEXT) ILIKE :sDate", { sDate: `${searchDate}%` }); hasSearchParams = true; }

      let tokensFound: Token[] = [];
      if (hasSearchParams) {
        tokensFound = await query.orderBy("t.id", "DESC").getMany();
      } else {
        const pending = await tokenRepo.findOne({ where: { user: { id: user.id }, customerName: finalCustomerName, status: "pending" }, order: { id: "ASC" } });
        if (pending) tokensFound = [pending];
      }

      if (tokensFound.length === 0) return res.json({ msg: `🤖 Dealer *${user.name}* ki Customer *${finalCustomerName}* ke liye koi matching token nahi mili.` });
      if (tokensFound.length > 1) return res.json({ msg: `🤖 Is criteria par mujhe **${tokensFound.length} tokens** mili hain! Kripya exact Truck No ya Weight batayein.` });

      let tokenToUpdate = tokensFound[0];

      // --- STOCK SUFFICIENT CHECK ---
      const account = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: tokenToUpdate.materialType } });
      const oldWeight = Number(tokenToUpdate.weight || 0);

      let finalNewWeight = oldWeight;
      if (newWeight !== undefined && newWeight !== null && newWeight !== "") {
        finalNewWeight = Number(newWeight);
      }

      const diff = finalNewWeight - oldWeight;

      if (diff > 0 && account && diff > Number(account.remainingTons)) {
        return res.json({ msg: `🤖 Stock kam hai! Aapke paas sirf ${account.remainingTons} Tons bache hain.` });
      }

      // --- ✏️ VALUES UPDATE ---
      if (newTruckNumber) tokenToUpdate.truckNumber = newTruckNumber;
      tokenToUpdate.weight = finalNewWeight;

      if (newCommission !== undefined && newCommission !== null && newCommission !== "") {
        tokenToUpdate.commission = Number(newCommission);
      }

      const rateToUse = tokenToUpdate.ratePerTon || RATE_PER_TON;
      tokenToUpdate.totalAmount = (finalNewWeight * rateToUse) + Number(tokenToUpdate.commission || 0);

      if (newDate) {
        tokenToUpdate.updatedAt = new Date(newDate);
      } else if (tokenToUpdate.status === "pending") {
        tokenToUpdate.updatedAt = new Date();
      }

      // 💾 Token ko database me save karein taaki total weight me shamil ho jaye
      await tokenRepo.save(tokenToUpdate);

      // --- 🧮 AUTO-HEALING STOCK CALCULATION (Aapka Formula) ---
      if (account) {
        // Step 1: User ke us material ki saari tokens nikalo
        const allTokensForStock = await tokenRepo.find({
          where: { user: { id: user.id }, materialType: tokenToUpdate.materialType }
        });

        // Step 2: Sabka weight jod kar Used Tons banao
        let exactUsedTons = 0;
        allTokensForStock.forEach(t => {
          exactUsedTons += Number(t.weight || 0);
        });

        // Step 3: Total - Used = Remaining
        account.usedTons = exactUsedTons;
        account.remainingTons = Number(account.totalTons) - exactUsedTons;

        await accountRepo.save(account);
      }

      // --- 🔄 LEDGER (CARRY FORWARD) RECALCULATION ---
      const adminId = user.role === "user" ? user.creator?.id : user.id;

      const prevTokenBeforeCurrent = await tokenRepo.createQueryBuilder("t")
        .leftJoin("t.user", "u").leftJoin("u.creator", "c")
        .where("t.customerName = :cName", { cName: finalCustomerName })
        .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
        .andWhere("t.id < :id", { id: tokenToUpdate.id })
        .orderBy("t.id", "DESC").getOne();

      let runningCarry = prevTokenBeforeCurrent ? Number(prevTokenBeforeCurrent.carryForward || 0) : 0;

      const allRelevantTokens = await tokenRepo.createQueryBuilder("t")
        .leftJoinAndSelect("t.user", "u")
        .where("t.customerName = :cName", { cName: finalCustomerName })
        .andWhere("t.id >= :id", { id: tokenToUpdate.id })
        .orderBy("t.id", "ASC").getMany();

      const tokensToSave = allRelevantTokens.map(t => t.id === tokenToUpdate.id ? tokenToUpdate : t);

      for (const t of tokensToSave) {
        const tTotal = Number(t.totalAmount || 0);
        const tPaid = Number(t.paidAmount || 0);
        runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
        t.carryForward = runningCarry;
        if (tTotal > 0 && t.status === "pending") {
          t.status = "updated";
        }
      }

      await tokenRepo.save(tokensToSave);

      return res.json({
        msg: `✅ Token #${tokenToUpdate.id} successfully update ho gaya!\n\n🚛 Truck: ${tokenToUpdate.truckNumber || "N/A"}\n⚖️ Weight: ${tokenToUpdate.weight} Tons\n💰 Commission: ₹${tokenToUpdate.commission || 0}\n💵 Total Bill: ₹${tokenToUpdate.totalAmount}`
      });
    }

    else {
      return res.json({ msg: "🤖 Command format clear nahi hai." });
    }

  } catch (error: any) {
    console.error("🔥 AI Crash Error:", error);
    if (error?.status === 429) return res.status(429).json({ msg: "🤖 Rate Limit! Kripya 1 minute baad try karein." });
    return res.status(500).json({ msg: "Server Error", error: error?.message });
  }
};