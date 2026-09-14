import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";

import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { PaymentHistory } from "../models/PaymentHistory";
import { sendWhatsAppReceipt } from "../services/whatsappService";
import { generateAndSendUserReportPDF } from "../services/whatappSendServices";

const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const userRepo = AppDataSource.getRepository(User);
const paymentHistoryRepo = AppDataSource.getRepository(PaymentHistory);

const TRUCK_CAPACITY = 27; // 27 Tons standard aasra

/**
 * 🟢 Helper 1: Dynamic Available Token Calculator (Sirf Admin Reports ke liye)
 */
const calculateAvailableTokens = async (userId: number, materialType: string) => {
  const account = await accountRepo.findOne({
    where: { user: { id: userId }, materialType: materialType as any },
  });

  const actualRemainingTons = account ? Number(account.remainingTons || 0) : 0;

  // Dealer ki jitni bhi pending tokens hain unhe count karein
  const pendingCount = await tokenRepo.count({
    where: {
      user: { id: userId },
      materialType: materialType as any,
      status: "pending",
    },
  });

  // Har pending token aasre 27 tons block karti hai
  const reservedTons = pendingCount * TRUCK_CAPACITY;
  const effectiveRemainingTons = Math.max(0, actualRemainingTons - reservedTons);

  // Bachi hui available token capacity
  const tokensAvailable = Math.max(0, Math.floor(effectiveRemainingTons / TRUCK_CAPACITY));

  return {
    actualRemainingTons,
    pendingCount,
    reservedTons,
    effectiveRemainingTons,
    tokensAvailable,
  };
};

/**
 * 🟢 Helper 2: Customer ki SAARE USERS/DEALERS me pending/updated tokens ki list (Customer Message ke liye)
 */
const buildCustomerAllDealersTokensSummary = async (
  customerName: string,
  adminId?: number,
  excludeTokenId?: number
): Promise<string> => {
  let query = tokenRepo
    .createQueryBuilder("t")
    .leftJoinAndSelect("t.user", "u")
    .leftJoin("u.creator", "c")
    .where("t.customerName = :customerName", { customerName })
    .andWhere("t.status IN (:...statuses)", { statuses: ["pending", "updated"] });

  if (adminId) {
    query = query.andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId });
  }

  if (excludeTokenId) {
    query = query.andWhere("t.id != :excludeTokenId", { excludeTokenId });
  }

  const tokens = await query.orderBy("t.id", "ASC").getMany();

  if (tokens.length === 0) return "";

  let summary = `\n📋 *Your Pending / Dues Tokens Across All Dealers:*\n`;
  tokens.forEach((t, idx) => {
    const weight = Number(t.weight || 0);
    const rate = Number(t.ratePerTon || 180);
    const comm = Number(t.commission || 0);
    const total = Number(t.totalAmount || 0);
    const paid = Number(t.paidAmount || 0);
    const due = total - paid;
    const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-GB") : "N/A";
    const dealerName = t.user?.name || "N/A";

    summary += `\n${idx + 1}. 🎫 *Token #${t.id}* (${dateStr}) - Status: *${t.status.toUpperCase()}*`;
    summary += `\n   👤 Issued Dealer: *${dealerName}*`;
    summary += `\n   📦 Material: ${t.materialType} | 🚛 Truck: ${t.truckNumber || "Pending"}`;
    if (t.status === "updated" || total > 0) {
      summary += `\n   ⚖️ Weight: ${weight}T × ₹${rate} + ₹${comm} = *₹${total}*`;
      summary += `\n   💰 Paid: ₹${paid} | ⏳ Due: *₹${due}*`;
    } else {
      summary += `\n   ⏳ Loading & Weight Pending`;
    }
  });
  summary += `\n`;

  return summary;
};

/**
 * 🟢 Helper 3: Us Dealer/User ke SARE Customers ki Pending & Updated Tokens ki List (Admin ke liye)
 */
const buildAllCustomersTokensForDealer = async (
  userId: number,
  excludeTokenId?: number
): Promise<string> => {
  let query = tokenRepo
    .createQueryBuilder("t")
    .leftJoinAndSelect("t.user", "u")
    .where("u.id = :userId", { userId })
    .andWhere("t.status IN (:...statuses)", { statuses: ["pending", "updated"] });

  if (excludeTokenId) {
    query = query.andWhere("t.id != :excludeTokenId", { excludeTokenId });
  }

  const allTokens = await query.orderBy("t.customerName", "ASC").addOrderBy("t.id", "ASC").getMany();

  if (allTokens.length === 0) {
    return "\n📋 *Dealer Status:* No pending or unpaid tokens for any customer under this dealer.\n";
  }

  const grouped: Record<string, typeof allTokens> = {};
  for (const t of allTokens) {
    const cName = t.customerName || "Unknown Customer";
    if (!grouped[cName]) grouped[cName] = [];
    grouped[cName].push(t);
  }

  let report = `\n📋 *ALL CUSTOMERS' PENDING & UPDATED TOKENS UNDER THIS DEALER:*\n`;
  let customerIndex = 1;

  for (const [custName, cTokens] of Object.entries(grouped)) {
    report += `\n━━━━━━━━━━━━━━━━━━━━━━━`;
    report += `\n👤 *${customerIndex++}. Customer: ${custName}* (Total: ${cTokens.length} Tokens)`;

    cTokens.forEach((t, idx) => {
      const weight = Number(t.weight || 0);
      const rate = Number(t.ratePerTon || 180);
      const comm = Number(t.commission || 0);
      const total = Number(t.totalAmount || 0);
      const paid = Number(t.paidAmount || 0);
      const due = total - paid;
      const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-GB") : "N/A";

      report += `\n  [${idx + 1}] 🎫 *#${t.id}* (${dateStr}) - *${t.status.toUpperCase()}*`;
      report += `\n      📦 ${t.materialType} | 🚛 ${t.truckNumber || "Truck Pending"}`;
      if (t.status === "updated" || total > 0) {
        report += `\n      ⚖️ ${weight}T × ₹${rate} + ₹${comm} = *₹${total}* (Due: *₹${due}*)`;
      } else {
        report += `\n      ⏳ Weight Pending`;
      }
    });
  }
  report += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;

  return report;
};

// ==========================================
// 1. CREATE TOKEN
// ==========================================
export const createToken = async (req: Request, res: Response) => {
  try {
    const { customerName, customerPhone, materialType, userId } = req.body;

    const user = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const adminUser = user.role === "user" ? user.creator : user;
    const adminId = adminUser?.id;
    const adminPhone = (adminUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    const lastToken = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "DESC")
      .getOne();

    const prevCarry = lastToken ? Number(lastToken.carryForward || 0) : 0;

    const token = tokenRepo.create({
      customerName,
      customerPhone,
      materialType,
      user,
      status: "pending",
      carryForward: prevCarry,
      paidAmount: 0,
      truckNumber: undefined,
      weight: 0,
      commission: 0,
      totalAmount: 0,
    });

    await tokenRepo.save(token);

    // Dynamic token count calculate karein (Sirf Admin ke liye)
    const tokenInfo = await calculateAvailableTokens(user.id, token.materialType);

    (async () => {
      try {
        const carryText = token.carryForward < 0 
          ? `₹${Math.abs(token.carryForward)} (TOTAL DUE / BAKI)` 
          : `₹${token.carryForward} (TOTAL ADVANCE)`;

        // 1. Customer ko message
        if (token.customerPhone) {
          const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(
            customerName,
            adminId,
            token.id
          );

          const custMsg =
            `🎉 *Token Generated Successfully!* 🎉\n\n` +
            `👤 Customer: *${token.customerName}*\n` +
            `🎫 *Token ID:* #${token.id}\n` +
            `📅 Date: ${new Date().toLocaleDateString("en-GB")}\n` +
            `👤 Issued Dealer: *${user.name}*\n` +
            `📦 Material: *${token.materialType.toUpperCase()}*\n` +
            `⏳ Status: *PENDING* (Loading Awaited)\n\n` +
            `📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n` +
            `👉 *${carryText}*\n` +
            allDealersTokensSummary +
            `\nThank you for doing business with us! - Bricks Admin`;

          await sendWhatsAppReceipt(token.customerPhone, custMsg, waInstance, waToken);
        }

        // 2. Admin Alert
        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(user.id);

          const adminAlertMsg =
            `🔔 *Admin Alert: New Token Created* 🔔\n\n` +
            `👤 Dealer/User: *${user.name}*\n` +
            `👤 New Token Customer: *${token.customerName}*\n` +
            `🎫 Token ID: *#${token.id}*\n` +
            `📦 Material: *${token.materialType.toUpperCase()}*\n` +
            `• Actual Remaining Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n` +
            `• Pending Trucks Reserved: *${tokenInfo.reservedTons} Tons* (${tokenInfo.pendingCount} trucks × 27T)\n` +
            `• 🎫 *Tokens Still Available to Issue:* *${tokenInfo.tokensAvailable} Tokens*\n` +
            `🔄 Customer Final Net Balance: *${carryText}*\n` +
            allDealerCustomersReport +
            `- Bricks Admin Automated System`;

          await sendWhatsAppReceipt(adminPhone, adminAlertMsg, waInstance, waToken);
        }
      } catch (err) {
        console.error("WhatsApp delivery failed on create token:", err);
      }
    })();

    return res.json({ msg: "✅ Token created", data: token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

// ==========================================
// 2. UPDATE TOKEN
// ==========================================
export const updateToken = async (req: Request, res: Response) => {
  try {
    const { tokenId, userId, truckNumber, weight, commission, totalAmount, manualDate } = req.body;
    const currentUser = (req as any).user;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user", "user.creator"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    if (currentUser.role === "admin" && token.user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "Access denied: Not your user's token" });
    }

    let targetUser = token.user;

    if (["admin", "superadmin"].includes(currentUser.role) && userId) {
      const newUser = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
      if (!newUser) return res.status(404).json({ msg: "Target user not found" });
      targetUser = newUser;
    }

    const account = await accountRepo.findOne({
      where: { user: { id: targetUser.id }, materialType: token.materialType },
    });

    if (!account) return res.status(400).json({ msg: "Material account not found" });

    // ✅ Safe Weight Parsing
    const oldWeight = Number(token.weight || 0);
    const newWeight = (weight !== undefined && weight !== null && weight !== "") ? Number(weight) : oldWeight;
    const diff = newWeight - oldWeight;

    // Check balance before proceeding
    if (diff > 0 && diff > Number(account.remainingTons)) {
      return res.status(400).json({
        msg: `Insufficient balance. Available: ${account.remainingTons}`,
      });
    }

    const ratePerTon = 180;
    
    // ✅ Safe Commission Parsing
    const safeCommission = (commission !== undefined && commission !== null && commission !== "") ? Number(commission) : Number(token.commission || 0);

    // ✅ Safe Total Amount Parsing
    const finalTotalAmount =
      (totalAmount !== undefined && totalAmount !== null && totalAmount !== "")
        ? Number(totalAmount)
        : (newWeight * ratePerTon) + safeCommission;

    const adminId = targetUser.role === "user" ? targetUser.creator?.id : targetUser.id;

    // Update Token Fields
    token.user = targetUser;
    if (truckNumber !== undefined) token.truckNumber = truckNumber;
    token.weight = newWeight;
    token.commission = safeCommission;
    token.ratePerTon = ratePerTon;
    token.totalAmount = finalTotalAmount;

    if (manualDate) {
      token.updatedAt = new Date(manualDate);
    }

    // 💾 Token Database me save karna (Taki auto-healing ise count kar sake)
    await tokenRepo.save(token);

    // ==========================================
    // 🧮 AUTO-HEALING STOCK CALCULATION
    // ==========================================
    if (account) {
      // 1. User ke us material ki saari tokens nikalo
      const allTokensForStock = await tokenRepo.find({
        where: { user: { id: targetUser.id }, materialType: token.materialType }
      });

      // 2. Sabka weight jod kar Used Tons banao
      let exactUsedTons = 0;
      allTokensForStock.forEach(t => {
        exactUsedTons += Number(t.weight || 0);
      });

      // 3. Total - Used = Remaining (Zero NaN chance)
      account.usedTons = exactUsedTons;
      account.remainingTons = Number(account.totalTons) - exactUsedTons;

      await accountRepo.save(account);
    }
    // ==========================================

    // Ledger Re-calculation
    const prevTokenBeforeCurrent = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .andWhere("t.id < :id", { id: token.id })
      .orderBy("t.id", "DESC")
      .getOne();

    const previousCarryForward = prevTokenBeforeCurrent
      ? Number(prevTokenBeforeCurrent.carryForward || 0)
      : 0;

    const allRelevantTokens = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .andWhere("t.id >= :id", { id: token.id })
      .orderBy("t.id", "ASC")
      .getMany();

    let runningCarry = previousCarryForward;

    for (const t of allRelevantTokens) {
      const tTotal = Number(t.totalAmount || 0);
      const tPaid = Number(t.paidAmount || 0);

      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;

      if (tTotal > 0 && t.status === "pending") {
        t.status = "updated";
      }
    }

    if (allRelevantTokens.length > 0) {
      await tokenRepo.save(allRelevantTokens);
    }

    // Ledger update ke baad, iss customer ki sabse aakhri token nikalein Final Balance show karne ke liye
    const absoluteLatestToken = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "DESC")
      .getOne();

    const actualFinalCarry = absoluteLatestToken ? Number(absoluteLatestToken.carryForward) : Number(token.carryForward);

    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const adminPhone = (adminUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    // Token count calculation sirf Admin ke report ke liye
    const tokenInfo = await calculateAvailableTokens(targetUser.id, token.materialType);

    (async () => {
      try {
        const prevCarryStr = previousCarryForward < 0
          ? `-₹${Math.abs(previousCarryForward)} (BAKI / DUE)`
          : `+₹${previousCarryForward} (ADVANCE)`;

        const currentBill = Number(token.totalAmount || 0);
        const paidAmt = Number(token.paidAmount || 0);
        const tokenCalculatedCarry = Number((previousCarryForward - currentBill + paidAmt).toFixed(2));

        const carryAnswerText = tokenCalculatedCarry < 0
          ? `-₹${Math.abs(tokenCalculatedCarry)} (BAKI / DUE)`
          : `+₹${tokenCalculatedCarry} (ADVANCE)`;

        const actualCarryText = actualFinalCarry < 0
          ? `-₹${Math.abs(actualFinalCarry)} (TOTAL DUE / BAKI)`
          : `+₹${actualFinalCarry} (TOTAL ADVANCE)`;

        // 1. Message to CUSTOMER
        if (token.customerPhone) {
          const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(
            token.customerName,
            adminId,
            token.id
          );

          const customerMsg =
            `✅ *Token Loaded & Updated!* ✅\n\n` +
            `👤 Customer: *${token.customerName}*\n` +
            `🎫 *Token ID:* #${token.id}\n` +
            `📅 Date: ${new Date(token.updatedAt || new Date()).toLocaleDateString("en-GB")}\n` +
            `👤 Dealer: *${targetUser.name}*\n` +
            `🚛 Truck No: *${token.truckNumber}*\n` +
            `📦 Material: *${token.materialType.toUpperCase()}*\n\n` +
            `📊 *Billing Details:*\n` +
            `• Loaded Weight: *${token.weight} Tons*\n` +
            `• Rate Per Ton: ₹${token.ratePerTon} | Commission: ₹${token.commission}\n` +
            `• 🧮 Bill Formula: (${token.weight}T × ₹${token.ratePerTon}) + ₹${token.commission} = *₹${currentBill}*\n` +
            `• Current Bill Amount: *₹${currentBill}*\n` +
            `• Paid for this Token: ₹${paidAmt}\n\n` +
            `🔄 *Step Calculation (Till Token #${token.id}):*\n` +
            `• Previous Carry Forward: *${prevCarryStr}*\n` +
            `• Token Balance: (${previousCarryForward}) - (${currentBill}) + (${paidAmt}) = *${carryAnswerText}*\n\n` +
            `📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n` +
            `👉 *${actualCarryText}*\n\n` +
            `⏳ Status: *${token.status.toUpperCase()}*\n` +
            allDealersTokensSummary +
            `\nThank you for doing business with us! - Bricks Admin`;

          await sendWhatsAppReceipt(token.customerPhone, customerMsg, waInstance, waToken);
        }

        // 2. Message to ADMIN
        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(targetUser.id);

          const adminAlertMsg =
            `🚚 *Admin Alert: Token Updated* 🚚\n\n` +
            `👤 Dealer: *${targetUser.name}*\n` +
            `👤 Customer: *${token.customerName}*\n` +
            `🎫 Token ID: *#${token.id}*\n` +
            `🚛 Truck No: *${token.truckNumber}*\n` +
            `⚖️ Loaded Weight: *${token.weight} Tons*\n` +
            `💰 Bill: *₹${currentBill}*\n` +
            `🔄 Token Balance Calculation: (${previousCarryForward}) - (${currentBill}) + (${paidAmt}) = *${carryAnswerText}*\n` +
            `📌 *Customer Final Net Balance: ${actualCarryText}*\n` +
            `📉 Exact Dealer Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n` +
            `🎫 *Tokens Still Available to Issue:* *${tokenInfo.tokensAvailable} Tokens*\n` +
            allDealerCustomersReport +
            `- Bricks Admin Automated System`;

          await sendWhatsAppReceipt(adminPhone, adminAlertMsg, waInstance, waToken);
        }

        // 3. Broadcast to other pending trucks (Customer stock alert)
        const userPendingTokens = await tokenRepo
          .createQueryBuilder("t")
          .leftJoin("t.user", "u")
          .where("t.status = :status", { status: "pending" })
          .andWhere("t.materialType = :materialType", { materialType: token.materialType })
          .andWhere("u.id = :targetUserId", { targetUserId: targetUser.id })
          .andWhere("t.id != :currentId", { currentId: token.id })
          .getMany();

        const notifiedPhones = new Set<string>();

        for (const pt of userPendingTokens) {
          if (pt.customerPhone && !notifiedPhones.has(pt.customerPhone)) {
            notifiedPhones.add(pt.customerPhone);
            const broadcastMsg =
              `🚨 *Stock Update Alert* 🚨\n\n` +
              `Hello *${pt.customerName}*,\n\n` +
              `Another truck was just loaded under dealer *${targetUser.name}*.\n\n` +
              `📦 Material: *${token.materialType.toUpperCase()}*\n` +
              `📉 Remaining Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n\n` +
              `Please check balance before bringing your truck to load.\n\n- Bricks Admin System`;

            await sendWhatsAppReceipt(pt.customerPhone, broadcastMsg, waInstance, waToken);
          }
        }
      } catch (waErr) {
        console.error("WhatsApp delivery failed on update:", waErr);
      }
    })();

    return res.json({
      msg: "✅ Token updated & Broadcast alert sent to user's pending trucks",
      data: token,
    });
  } catch (err) {
    console.error("Update token error:", err);
    return res.status(500).json({ msg: "Server error" });
  }
};

// ==========================================
// 3. DELETE TOKEN
// ==========================================
export const deleteToken = async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const currentUser = req.user!;

    const token = await tokenRepo.findOne({
      where: { id: Number(tokenId) },
      relations: ["user", "user.creator"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    if (currentUser.role === "admin" && token.user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "Access denied: Not your user's token" });
    }

    if (token.status !== "pending") {
      return res.status(400).json({
        msg: "❌ Only pending tokens can be deleted",
      });
    }

    const customerPhone = token.customerPhone;
    const customerName = token.customerName;
    const materialType = token.materialType;
    const deletedTokenId = token.id;
    const dealerUser = token.user;
    const dealerName = dealerUser?.name || "N/A";

    const adminUser = dealerUser.role === "user" ? dealerUser.creator : dealerUser;
    const adminId = adminUser?.id;
    const adminPhone = (adminUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    await tokenRepo.remove(token);

    // Deletion ke baad token count restored calculation (Sirf admin ke liye)
    const tokenInfo = await calculateAvailableTokens(dealerUser.id, materialType);

    const latestTokenAfterDelete = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "DESC")
      .getOne();

    const finalCarry = latestTokenAfterDelete ? Number(latestTokenAfterDelete.carryForward) : 0;
    const carryText = finalCarry < 0 
      ? `₹${Math.abs(finalCarry)} (TOTAL DUE / BAKI)` 
      : `₹${finalCarry} (TOTAL ADVANCE)`;

    (async () => {
      try {
        // 1. Message to CUSTOMER
        if (customerPhone) {
          const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(
            customerName,
            adminId,
            deletedTokenId
          );

          const cancelMsg =
            `❌ *Token Cancelled & Removed!* ❌\n\n` +
            `👤 Customer: *${customerName}*\n` +
            `🎫 *Cancelled Token ID:* #${deletedTokenId}\n` +
            `📅 Date: ${new Date().toLocaleDateString("en-GB")}\n` +
            `👤 Dealer: *${dealerName}*\n` +
            `📦 Material: *${materialType.toUpperCase()}*\n\n` +
            `📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n` +
            `👉 *${carryText}*\n` +
            allDealersTokensSummary +
            `\nPlease contact your dealer for any clarification.\n\n- Bricks Admin System`;

          await sendWhatsAppReceipt(customerPhone, cancelMsg, waInstance, waToken);
        }

        // 2. Message to ADMIN
        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(
            dealerUser.id,
            deletedTokenId
          );

          const adminAlertMsg =
            `🗑️ *Admin Alert: Pending Token Deleted* 🗑️\n\n` +
            `👤 Dealer: *${dealerName}*\n` +
            `👤 Customer: *${customerName}*\n` +
            `🎫 Deleted Token ID: *#${deletedTokenId}*\n` +
            `📦 Material: *${materialType.toUpperCase()}*\n` +
            `📌 Customer Final Net Balance: *${carryText}*\n` +
            `📉 Dealer Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n` +
            `🎫 *Tokens Still Available to Issue:* *${tokenInfo.tokensAvailable} Tokens*\n` +
            allDealerCustomersReport +
            `- Bricks Admin Automated System`;

          await sendWhatsAppReceipt(adminPhone, adminAlertMsg, waInstance, waToken);
        }
      } catch (error) {
        console.error("WhatsApp delivery failed on delete:", error);
      }
    })();

    return res.json({ msg: "🗑️ Pending token deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

// ==========================================
// 4. CONFIRM TOKEN
// ==========================================
export const confirmToken = async (req: Request, res: Response) => {
  try {
    const { tokenId, paidAmount } = req.body;
    const currentUser = req.user!;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user", "user.creator"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    if (currentUser.role === "admin" && token.user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "Access denied: Not your user's token" });
    }

    const adminId = token.user.role === "user" ? token.user.creator?.id : token.user.id;

    const tokens = await tokenRepo
      .createQueryBuilder("t")
      .leftJoinAndSelect("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "ASC")
      .getMany();

    let remainingPayment = Number(paidAmount);
    let paymentDetails: any[] = [];

    for (const t of tokens) {
      if (remainingPayment <= 0) break;
      const total = Number(t.totalAmount || 0);
      if (total <= 0) continue;

      const alreadyPaid = Number(t.paidAmount || 0);
      const due = total - alreadyPaid;

      if (due > 0) {
        const payNow = Math.min(due, remainingPayment);
        t.paidAmount = alreadyPaid + payNow;
        t.confirmedAt = new Date();
        remainingPayment -= payNow;

        paymentDetails.push({
          tokenId: t.id,
          userName: t.user.name,
          customerName: t.customerName,
          truckNumber: t.truckNumber || "N/A",
          materialType: t.materialType,
          weight: t.weight,
          ratePerTon: t.ratePerTon || 180,
          commission: t.commission || 0,
          totalAmount: total,
          paidThisTime: payNow,
          totalPaidNow: t.paidAmount,
          dueNow: total - t.paidAmount,
          isFullyCleared: t.paidAmount >= total,
        });
      }
    }

    if (remainingPayment > 0 && tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1];
      lastToken.paidAmount = Number(lastToken.paidAmount || 0) + remainingPayment;
      lastToken.confirmedAt = new Date();
    }

    let runningCarry = 0;
    for (const t of tokens) {
      const tTotal = Number(t.totalAmount || 0);
      const tPaid = Number(t.paidAmount || 0);

      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;

      if (tTotal > 0) {
        t.status = runningCarry >= 0 ? "completed" : "updated";
      }
    }

    await tokenRepo.save(tokens);

    const history = paymentHistoryRepo.create({
      user: token.user,
      admin: { id: currentUser.id } as any,
      type: "token_payment",
      amount: paidAmount,
      details: {
        confirmedTokens: paymentDetails,
        advanceLeft: remainingPayment > 0 ? remainingPayment : 0,
      },
    });
    await paymentHistoryRepo.save(history);

    const adminUser = token.user.role === "user" ? token.user.creator : token.user;
    const adminPhone = (adminUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    (async () => {
      try {
        const fullyClearedTokens = paymentDetails.filter((p) => p.isFullyCleared);
        const partiallyPaidTokens = paymentDetails.filter((p) => !p.isFullyCleared);

        let paymentBreakdownText = `\n💳 *Payment Settlement Breakdown:*\n`;

        if (fullyClearedTokens.length > 0) {
          paymentBreakdownText += `\n✅ *Fully Cleared Tokens:*\n`;
          fullyClearedTokens.forEach((p) => {
            paymentBreakdownText += `• 🎫 Token #${p.tokenId} (${p.materialType}): ₹${p.paidThisTime} received (Total ₹${p.totalAmount} Cleared)\n`;
          });
        }

        if (partiallyPaidTokens.length > 0) {
          paymentBreakdownText += `\n⏳ *Partially Cleared (Still Pending):*\n`;
          partiallyPaidTokens.forEach((p) => {
            paymentBreakdownText += `• 🎫 Token #${p.tokenId} (${p.materialType}):\n`;
            paymentBreakdownText += `   Bill: ₹${p.totalAmount} | Received: ₹${p.paidThisTime}\n`;
            paymentBreakdownText += `   Total Paid: ₹${p.totalPaidNow} | *Baki Due: ₹${p.dueNow}*\n`;
          });
        }

        if (remainingPayment > 0) {
          paymentBreakdownText += `\n🎁 *Extra Advance Deposited:* ₹${remainingPayment}\n`;
        }

        const netCarryText = runningCarry < 0 
          ? `₹${Math.abs(runningCarry)} (TOTAL DUE / BAKI)` 
          : `₹${runningCarry} (TOTAL ADVANCE)`;

        const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(
          token.customerName,
          adminId
        );

        const confirmMsg =
          `💰 *Payment Received & Account Balanced!* 💰\n\n` +
          `👤 Customer: *${token.customerName}*\n` +
          `📅 Date: ${new Date().toLocaleDateString("en-GB")}\n` +
          `💵 *Total Amount Paid:* ₹${paidAmount}\n` +
          paymentBreakdownText +
          `\n📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n` +
          `👉 *${netCarryText}*\n` +
          allDealersTokensSummary +
          `\nThank you for prompt settlement! - Bricks Admin`;

        if (token.customerPhone) {
          await sendWhatsAppReceipt(token.customerPhone, confirmMsg, waInstance, waToken);
        }

        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(token.user.id);
          const adminConfirmMsg =
            `💰 *Admin Alert: Payment Received* 💰\n\n` +
            `👤 Dealer: *${token.user.name}*\n` +
            `👤 Customer: *${token.customerName}*\n` +
            `💵 Paid Amount: *₹${paidAmount}*\n` +
            `📌 Customer Final Net Balance: *${netCarryText}*\n` +
            allDealerCustomersReport +
            `- Bricks Admin Automated System`;

          await sendWhatsAppReceipt(adminPhone, adminConfirmMsg, waInstance, waToken);
        }
      } catch (waErr) {
        console.error("WhatsApp delivery failed on confirm payment:", waErr);
      }
    })();

    return res.json({
      msg: "✅ Ledger balanced and payment recorded in History",
      customerName: token.customerName,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

// ==========================================
// 5. GET CONTROLLERS & REPORTS
// ==========================================
export const getAllTokens = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user!;

    const targetUser = await userRepo.findOne({
      where: { id: Number(userId) },
      relations: ["creator"],
    });

    if (!targetUser) return res.status(404).json({ msg: "User not found" });

    if (currentUser.role === "user" && currentUser.id !== targetUser.id) {
      return res.status(403).json({ msg: "Access denied" });
    }
    if (currentUser.role === "admin" && targetUser.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "Access denied: Not your user" });
    }

    const tokens = await tokenRepo.find({
      where: { user: { id: targetUser.id } },
      relations: ["user"],
      order: { id: "DESC" },
    });

    return res.json({ msg: "✅ Tokens fetched", count: tokens.length, data: tokens });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

export const getAdminAllUserTokens = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;

    if (currentUser.role === "user") {
      return res.status(403).json({ msg: "Access denied" });
    }

    let users: User[] = [];

    if (currentUser.role === "superadmin") {
      users = await userRepo.find({ where: { role: "user" } });
    } else {
      users = await userRepo.find({
        where: { role: "user", creator: { id: currentUser.id } },
      });
    }

    const userIds = users.map((u) => u.id);

    if (userIds.length === 0) {
      return res.json({ msg: "✅ Admin token report fetched", totalTokens: 0, data: [] });
    }

    const tokens = await tokenRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ["user"],
      order: { id: "DESC" },
    });

    const accounts = await accountRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ["user"],
    });

    const getRemaining = (userId: number, material: string) => {
      const acc = accounts.find((a) => a.user.id === userId && a.materialType === material);
      return acc ? Number(acc.remainingTons).toFixed(3) : "0.000";
    };

    const table = tokens.map((t) => ({
      tokenId: t.id,
      customerName: t.customerName,
      truckNumber: t.truckNumber,
      materialType: t.materialType,
      weight: t.weight,
      totalAmount: t.totalAmount,
      commission: t.commission,
      ratePerTon: t.ratePerTon,
      paidAmount: t.paidAmount,
      carryForward: t.carryForward,
      status: t.status,
      userId: t.user.id,
      userName: t.user.name,
      remainingTons: getRemaining(t.user.id, t.materialType),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      confirmedAt: t.confirmedAt,
    }));

    return res.json({
      msg: "✅ Admin token report fetched",
      totalTokens: table.length,
      data: table,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

export const sendUserReportToWhatsApp = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    const currentUser = req.user!;

    const user = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const tokens = await tokenRepo.find({
      where: { user: { id: user.id } },
      order: { id: "DESC" },
    });

    const accounts = await accountRepo.find({
      where: { user: { id: user.id } },
    });

    const adminUser = user.role === "user" ? user.creator : user;
    const adminPhone = (user as any).phone || (adminUser as any)?.phone;

    if (!adminPhone) {
      return res.status(400).json({ msg: "❌ User phone number not found for WhatsApp" });
    }

    await generateAndSendUserReportPDF(user, tokens, accounts, {
      instanceId: (adminUser as any)?.whatsappInstanceId,
      token: (adminUser as any)?.whatsappToken,
      phone: adminPhone,
    });

    return res.json({ msg: "📄 PDF Report successfully generated and sent to WhatsApp!" });
  } catch (error) {
    console.error("Error sending PDF report:", error);
    return res.status(500).json({ msg: "Server error while sending PDF report" });
  }
};