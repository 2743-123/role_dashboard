import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In, Brackets } from "typeorm";

import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { PaymentHistory } from "../models/PaymentHistory";
import { sendWhatsAppReceipt } from "../services/whatappSendServices";
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

  const pendingCount = await tokenRepo.count({
    where: {
      user: { id: userId },
      materialType: materialType as any,
      status: "pending",
    },
  });

  const reservedTons = pendingCount * TRUCK_CAPACITY;
  const effectiveRemainingTons = Math.max(0, actualRemainingTons - reservedTons);
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
// 🧠 SMART RE-BALANCER & STATUS ENGINE
// ==========================================
const syncLedgersAndStatuses = async (token: Token, adminId: number) => {
  const safeAdminId = adminId ?? 0;

  const balanceType = async (type: "customer" | "carting" | "tokenOwner", name: string | null | undefined) => {
    if (!name) return;
    
    let query = tokenRepo.createQueryBuilder("t").leftJoinAndSelect("t.user", "u").leftJoin("u.creator", "c")
      .where("(c.id = :adminId OR u.id = :adminId)", { adminId: safeAdminId }).orderBy("t.id", "ASC");
        
    if (type === "customer") query = query.andWhere("t.customerName = :name", { name });
    if (type === "carting") query = query.andWhere("t.cartingOwnerName = :name", { name });
    if (type === "tokenOwner") query = query.andWhere("t.anotherTokenOwnerName = :name", { name });

    const tokens = await query.getMany();
    if (!tokens.length) return;

    let totalPool = 0;
    for (const t of tokens) {
      if (type === "customer") totalPool += Number(t.paidAmount || 0);
      if (type === "carting") totalPool += Number(t.cartingPaidAmount || 0);
      if (type === "tokenOwner") totalPool += Number(t.tokenOwnerPaidAmount || 0);
    }

    let carry = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      let bill = 0;
      
      if (type === "customer") bill = Number(t.totalAmount || 0);
      if (type === "carting") bill = Number(t.totalCarting || 0);
      if (type === "tokenOwner") bill = Number(t.totalTokenOwnerAmount || 0);

      const payNow = Math.min(bill, totalPool);
      let newPaid = payNow;
      totalPool -= payNow;

      if (i === tokens.length - 1 && totalPool > 0) {
        newPaid += totalPool;
        totalPool = 0;
      }

      if (type === "customer") {
        t.paidAmount = newPaid;
        carry = Number((carry + newPaid - bill).toFixed(2));
        t.carryForward = carry;
      }
      if (type === "carting") {
        t.cartingPaidAmount = newPaid;
        carry = Number((carry + bill - newPaid).toFixed(2));
        t.cartingCarryForward = carry;
      }
      if (type === "tokenOwner") {
        t.tokenOwnerPaidAmount = newPaid;
        carry = Number((carry + bill - newPaid).toFixed(2));
        t.tokenOwnerCarryForward = carry;
      }
    }
    await tokenRepo.save(tokens);
  };

  await balanceType("customer", token.customerName);
  await balanceType("carting", token.cartingOwnerName);
  await balanceType("tokenOwner", token.anotherTokenOwnerName);

  const affectedTokens = await tokenRepo.createQueryBuilder("t").leftJoinAndSelect("t.user", "u").leftJoin("u.creator", "c")
    .where("(c.id = :adminId OR u.id = :adminId)", { adminId: safeAdminId })
    .andWhere(new Brackets(qb => {
      qb.where("t.customerName = :cust", { cust: token.customerName });
      if (token.cartingOwnerName) qb.orWhere("t.cartingOwnerName = :cart", { cart: token.cartingOwnerName });
      if (token.anotherTokenOwnerName) qb.orWhere("t.anotherTokenOwnerName = :own", { own: token.anotherTokenOwnerName });
    }))
    .getMany();

  for (const t of affectedTokens) {
    if (t.materialType === "bedash") {
        if (!t.cartingOwnerName) {
            t.cartingCarryForward = Number((Number(t.totalCarting || 0) - Number(t.cartingPaidAmount || 0)).toFixed(2));
        }
        if (!t.anotherTokenOwnerName && t.tokenOwnerType === "another") {
            t.tokenOwnerCarryForward = Number((Number(t.totalTokenOwnerAmount || 0) - Number(t.tokenOwnerPaidAmount || 0)).toFixed(2));
        }
    }

    if (Number(t.totalAmount || 0) > 0) {
      const isCust = Number(t.totalAmount || 0) === 0 || Number(t.paidAmount) >= Number(t.totalAmount) || Number(t.carryForward) >= 0;
      const isCart = t.materialType !== "bedash" || Number(t.totalCarting || 0) === 0 || Number(t.cartingPaidAmount) >= Number(t.totalCarting) || Number(t.cartingCarryForward || 0) <= 0;
      const isOwn = t.materialType !== "bedash" || Number(t.totalTokenOwnerAmount || 0) === 0 || Number(t.tokenOwnerPaidAmount) >= Number(t.totalTokenOwnerAmount) || Number(t.tokenOwnerCarryForward || 0) <= 0;
      
      if (isCust && isCart && isOwn && t.confirmedAt != null) {
        t.status = "completed";
      } else if (t.status !== "pending") {
        t.status = "updated";
      }
    }
  }
  await tokenRepo.save(affectedTokens);
};

// ==========================================
// 1. CREATE TOKEN 
// ==========================================
export const createToken = async (req: Request, res: Response) => {
  try {
    const { 
      customerName, customerPhone, materialType, userId,
      cartingOwnerName, cartingOwnerPhone, tokenOwnerType, 
      anotherTokenOwnerName, anotherTokenOwnerPhone 
    } = req.body;

    const user = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const adminUser = user.role === "user" ? user.creator : user;
    const adminId = adminUser?.id ?? 0;
    const adminPhone = (adminUser as any)?.phone;

    const lastToken = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "DESC").getOne();
    const prevCarry = lastToken ? Number(lastToken.carryForward || 0) : 0;

    let prevCartingCarry = 0;
    if (materialType === "bedash" && cartingOwnerName) {
      const lastCarting = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c")
        .where("t.cartingOwnerName = :cartingOwnerName", { cartingOwnerName }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
        .orderBy("t.id", "DESC").getOne();
      prevCartingCarry = lastCarting ? Number(lastCarting.cartingCarryForward || 0) : 0;
    }

    let prevTokenOwnerCarry = 0;
    if (materialType === "bedash" && tokenOwnerType === "another" && anotherTokenOwnerName) {
      const lastOwner = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c")
        .where("t.anotherTokenOwnerName = :anotherTokenOwnerName", { anotherTokenOwnerName }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
        .orderBy("t.id", "DESC").getOne();
      prevTokenOwnerCarry = lastOwner ? Number(lastOwner.tokenOwnerCarryForward || 0) : 0;
    }

    const token = tokenRepo.create({
      customerName, customerPhone, materialType, user, status: "pending",
      carryForward: prevCarry, paidAmount: 0, totalAmount: 0, weight: 0, commission: 0,
      cartingOwnerName: materialType === "bedash" ? cartingOwnerName : null,
      cartingOwnerPhone: materialType === "bedash" ? cartingOwnerPhone : null,
      tokenOwnerType: materialType === "bedash" ? (tokenOwnerType || "owner") : "owner",
      anotherTokenOwnerName: materialType === "bedash" && tokenOwnerType === "another" ? anotherTokenOwnerName : null,
      anotherTokenOwnerPhone: materialType === "bedash" && tokenOwnerType === "another" ? anotherTokenOwnerPhone : null,
      cartingCarryForward: prevCartingCarry,
      tokenOwnerCarryForward: prevTokenOwnerCarry,
    });

    await tokenRepo.save(token);
    const tokenInfo = await calculateAvailableTokens(user.id, token.materialType);

    (async () => {
      try {
        const carryText = token.carryForward < 0 
          ? `₹${Math.abs(token.carryForward)} (TOTAL DUE / BAKI)` 
          : `₹${token.carryForward} (TOTAL ADVANCE)`;

        if (token.customerPhone) {
          const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(customerName, adminId, token.id);
          const custMsg =
            `🎉 *Token Generated Successfully!* 🎉\n\n👤 Customer: *${token.customerName}*\n🎫 *Token ID:* #${token.id}\n📅 Date: ${new Date().toLocaleDateString("en-GB")}\n👤 Issued Dealer: *${user.name}*\n📦 Material: *${token.materialType.toUpperCase()}*\n⏳ Status: *PENDING* (Loading Awaited)\n\n📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n👉 *${carryText}*\n` + allDealersTokensSummary + `\nThank you for doing business with us! - Bricks Admin`;
          
          await sendWhatsAppReceipt(token.customerPhone, custMsg, adminId);
        }

        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(user.id);
          const adminAlertMsg =
            `🔔 *Admin Alert: New Token Created* 🔔\n\n👤 Dealer/User: *${user.name}*\n👤 New Token Customer: *${token.customerName}*\n🎫 Token ID: *#${token.id}*\n📦 Material: *${token.materialType.toUpperCase()}*\n• Actual Remaining Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n• Pending Trucks Reserved: *${tokenInfo.reservedTons} Tons*\n• 🎫 *Tokens Still Available:* *${tokenInfo.tokensAvailable} Tokens*\n🔄 Customer Final Balance: *${carryText}*\n` + allDealerCustomersReport + `- Bricks Admin Automated System`;
          
          await sendWhatsAppReceipt(adminPhone, adminAlertMsg, adminId);
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
    const { tokenId, userId, truckNumber, weight, commission, totalAmount, manualDate, sellRate, cartingRate, tokenOwnerRate } = req.body;
    const currentUser = (req as any).user;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user", "user.creator"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) return res.status(403).json({ msg: "Access denied" });
    if (currentUser.role === "admin" && token.user.creator?.id !== currentUser.id) return res.status(403).json({ msg: "Access denied" });

    let targetUser = token.user;

    if (["admin", "superadmin"].includes(currentUser.role) && userId) {
      const newUser = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
      if (!newUser) return res.status(404).json({ msg: "Target user not found" });
      targetUser = newUser;
    }

    const account = await accountRepo.findOne({ where: { user: { id: targetUser.id }, materialType: token.materialType } });
    if (!account) return res.status(400).json({ msg: "Material account not found" });

    const oldWeight = Number(token.weight || 0);
    const newWeight = (weight !== undefined && weight !== null && weight !== "") ? Number(weight) : oldWeight;
    const diff = newWeight - oldWeight;

    if (diff > 0 && diff > Number(account.remainingTons)) return res.status(400).json({ msg: `Insufficient balance. Available: ${account.remainingTons}` });

    if (diff !== 0) {
      account.remainingTons = Math.max(0, Number(account.remainingTons || 0) - diff);
      (account as any).usedTons = Math.max(0, Number(account.totalTons || 0) - Number(account.remainingTons));
      await accountRepo.save(account);
    }

    const ratePerTon = 180;
    const safeCommission = (commission !== undefined && commission !== null && commission !== "") ? Number(commission) : Number(token.commission || 0);

    if (token.materialType === "bedash") {
      const sRate = Number(sellRate !== undefined ? sellRate : token.sellRate || 0);
      const cRate = Number(cartingRate !== undefined ? cartingRate : token.cartingRate || 0);
      const oRate = Number(tokenOwnerRate !== undefined ? tokenOwnerRate : token.tokenOwnerRate || 0);

      token.sellRate = sRate;
      token.cartingRate = cRate;
      token.tokenOwnerRate = oRate;

      const totalSellAmount = sRate * newWeight;
      const totalCartingAmount = cRate * newWeight;

      token.totalAmount = totalSellAmount;
      token.totalCarting = totalCartingAmount;

      if (token.tokenOwnerType === "another") {
        token.totalTokenOwnerAmount = oRate * newWeight;
        token.commission = (sRate - cRate - oRate) * newWeight;
      } else {
        token.totalTokenOwnerAmount = 0;
        token.commission = totalSellAmount - totalCartingAmount - (newWeight * 180);
      }
    } else {
      const finalTotalAmount = (totalAmount !== undefined && totalAmount !== null && totalAmount !== "") ? Number(totalAmount) : (newWeight * ratePerTon) + safeCommission;
      token.commission = safeCommission;
      token.ratePerTon = ratePerTon;
      token.totalAmount = finalTotalAmount;
    }

    token.user = targetUser;
    if (truckNumber !== undefined) token.truckNumber = truckNumber;
    token.weight = newWeight;
    if (manualDate) token.updatedAt = new Date(manualDate);

    if (token.status === "pending" && newWeight > 0) token.status = "updated";

    await tokenRepo.save(token);

    const adminId = (targetUser.role === "user" ? targetUser.creator?.id : targetUser.id) ?? 0;
    await syncLedgersAndStatuses(token, adminId);

    const absoluteLatestToken = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c").where("t.customerName = :customerName", { customerName: token.customerName }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId }).orderBy("t.id", "DESC").getOne();
    const actualFinalCarry = absoluteLatestToken ? Number(absoluteLatestToken.carryForward) : Number(token.carryForward);

    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const adminPhone = (adminUser as any)?.phone;
    const tokenInfo = await calculateAvailableTokens(targetUser.id, token.materialType);

    (async () => {
      try {
        const currentBill = Number(token.totalAmount || 0);
        const paidAmt = Number(token.paidAmount || 0);
        const previousCarryForward = actualFinalCarry + currentBill - paidAmt;
        const prevCarryStr = previousCarryForward < 0 ? `-₹${Math.abs(previousCarryForward)} (BAKI / DUE)` : `+₹${previousCarryForward} (ADVANCE)`;
        const tokenCalculatedCarry = Number((previousCarryForward - currentBill + paidAmt).toFixed(2));
        const carryAnswerText = tokenCalculatedCarry < 0 ? `-₹${Math.abs(tokenCalculatedCarry)} (BAKI / DUE)` : `+₹${tokenCalculatedCarry} (ADVANCE)`;
        const actualCarryText = actualFinalCarry < 0 ? `-₹${Math.abs(actualFinalCarry)} (TOTAL DUE / BAKI)` : `+₹${actualFinalCarry} (TOTAL ADVANCE)`;

        if (token.customerPhone) {
          const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(token.customerName, adminId, token.id);
          const formulaLine = token.materialType === "bedash" ? `• 🧮 Bill Formula: (${token.weight}T × ₹${token.sellRate}) = *₹${currentBill}*\n` : `• 🧮 Bill Formula: (${token.weight}T × ₹${token.ratePerTon}) + ₹${token.commission} = *₹${currentBill}*\n`;
          const customerMsg = `✅ *Token Loaded & Updated!* ✅\n\n👤 Customer: *${token.customerName}*\n🎫 *Token ID:* #${token.id}\n📅 Date: ${new Date(token.updatedAt || new Date()).toLocaleDateString("en-GB")}\n👤 Dealer: *${targetUser.name}*\n🚛 Truck No: *${token.truckNumber}*\n📦 Material: *${token.materialType.toUpperCase()}*\n\n📊 *Billing Details:*\n• Loaded Weight: *${token.weight} Tons*\n` + formulaLine + `• Current Bill Amount: *₹${currentBill}*\n• Paid for this Token: ₹${paidAmt}\n\n🔄 *Step Calculation:*\n• Previous Carry Forward: *${prevCarryStr}*\n• Token Balance: *${carryAnswerText}*\n\n📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n👉 *${actualCarryText}*\n\n⏳ Status: *${token.status.toUpperCase()}*\n` + allDealersTokensSummary + `\nThank you for doing business with us! - Bricks Admin`;
          
          await sendWhatsAppReceipt(token.customerPhone, customerMsg, adminId);
        }

        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(targetUser.id);
          const adminAlertMsg = `🚚 *Admin Alert: Token Updated* 🚚\n\n👤 Dealer: *${targetUser.name}*\n👤 Customer: *${token.customerName}*\n🎫 Token ID: *#${token.id}*\n🚛 Truck No: *${token.truckNumber}*\n⚖️ Loaded Weight: *${token.weight} Tons*\n💰 Bill: *₹${currentBill}*\n📌 *Customer Final Net Balance: ${actualCarryText}*\n📉 Exact Dealer Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n🎫 *Tokens Still Available: *${tokenInfo.tokensAvailable} Tokens*\n` + allDealerCustomersReport + `- Bricks Admin Automated System`;
          
          await sendWhatsAppReceipt(adminPhone, adminAlertMsg, adminId);
        }
      } catch (waErr) {
        console.error("WhatsApp delivery failed on update:", waErr);
      }
    })();

    return res.json({ msg: "✅ Token updated", data: token });
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

    // 🛠️ FIX: Yahan { id } ki jagah { id: tokenId } pass kiya gaya hai
    const token = await tokenRepo.createQueryBuilder("token")
      .leftJoinAndSelect("token.user", "user")
      .leftJoinAndSelect("user.creator", "creator") 
      .where("token.id = :id", { id: tokenId })
      .getOne();

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) return res.status(403).json({ msg: "Access denied" });
    if (currentUser.role === "admin" && token.user.creator?.id !== currentUser.id) return res.status(403).json({ msg: "Access denied" });

    if (token.status !== "pending") return res.status(400).json({ msg: "❌ Only pending tokens can be deleted" });

    const customerPhone = token.customerPhone;
    const customerName = token.customerName;
    const materialType = token.materialType;
    const deletedTokenId = token.id;
    const dealerUser = token.user;
    const dealerName = dealerUser?.name || "N/A";

    const adminUser = dealerUser.role === "user" ? dealerUser.creator : dealerUser;
    const adminId = adminUser?.id ?? 0;
    const adminPhone = (adminUser as any)?.phone;

    if (token.weight > 0) {
      const materialAccount = await accountRepo.findOne({ where: { user: { id: token.user.id }, materialType: token.materialType as any } });
      if (materialAccount) {
        materialAccount.remainingTons = Number(materialAccount.remainingTons || 0) + Number(token.weight);
        (materialAccount as any).usedTons = Math.max(0, Number(materialAccount.totalTons || 0) - Number(materialAccount.remainingTons));
        await accountRepo.save(materialAccount);
      }
    }

    await tokenRepo.remove(token);
    const tokenInfo = await calculateAvailableTokens(dealerUser.id, materialType);
   const latestTokenAfterDelete = await tokenRepo.createQueryBuilder("t")
  .leftJoin("t.user", "u")
  .leftJoin("u.creator", "c") // ✅ FIX: t.creator ki jagah u.creator aayega
  .where("t.customerName = :customerName", { customerName })
  .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
  .orderBy("t.id", "DESC")
  .getOne();
    const finalCarry = latestTokenAfterDelete ? Number(latestTokenAfterDelete.carryForward) : 0;
    const carryText = finalCarry < 0 ? `₹${Math.abs(finalCarry)} (TOTAL DUE / BAKI)` : `₹${finalCarry} (TOTAL ADVANCE)`;

    (async () => {
      try {
        if (customerPhone) {
          const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(customerName, adminId, deletedTokenId);
          const cancelMsg = `❌ *Token Cancelled & Removed!* ❌\n\n👤 Customer: *${customerName}*\n🎫 *Cancelled Token ID:* #${deletedTokenId}\n📅 Date: ${new Date().toLocaleDateString("en-GB")}\n👤 Dealer: *${dealerName}*\n📦 Material: *${materialType.toUpperCase()}*\n\n📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n👉 *${carryText}*\n` + allDealersTokensSummary + `\nPlease contact your dealer for any clarification.\n\n- Bricks Admin System`;
          
          await sendWhatsAppReceipt(customerPhone, cancelMsg, adminId);
        }

        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(dealerUser.id, deletedTokenId);
          const adminAlertMsg = `🗑️ *Admin Alert: Pending Token Deleted* 🗑️\n\n👤 Dealer: *${dealerName}*\n👤 Customer: *${customerName}*\n🎫 Deleted Token ID: *#${deletedTokenId}*\n📦 Material: *${materialType.toUpperCase()}*\n📌 Customer Final Net Balance: *${carryText}*\n📉 Dealer Stock: *${tokenInfo.actualRemainingTons.toFixed(2)} Tons*\n🎫 *Tokens Still Available: *${tokenInfo.tokensAvailable} Tokens*\n` + allDealerCustomersReport + `- Bricks Admin Automated System`;
          
          await sendWhatsAppReceipt(adminPhone, adminAlertMsg, adminId);
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
    const { tokenId, paidAmount, cartingPaidAmount, tokenOwnerPaidAmount } = req.body;
    const currentUser = req.user!;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user", "user.creator"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) return res.status(403).json({ msg: "Access denied" });
    if (currentUser.role === "admin" && token.user.creator?.id !== currentUser.id) return res.status(403).json({ msg: "Access denied" });

    const adminId = (token.user.role === "user" ? token.user.creator?.id : token.user.id) ?? 0;

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

        const detailObj: any = {
          tokenId: t.id,
          userName: t.user.name,
          customerName: t.customerName,
          truckNumber: t.truckNumber || "N/A",
          materialType: t.materialType,
          weight: t.weight,
          ratePerTon: t.materialType === "bedash" ? t.sellRate : (t.ratePerTon || 180),
          commission: t.commission || 0,
          totalAmount: total,
          paidThisTime: payNow,
          totalPaidNow: t.paidAmount,
          dueNow: total - t.paidAmount,
          isFullyCleared: t.paidAmount >= total,
        };

        if (t.materialType === "bedash") {
          detailObj.sellRate = t.sellRate;
          detailObj.cartingRate = t.cartingRate;
          detailObj.totalCarting = t.totalCarting;
          detailObj.cartingOwnerName = t.cartingOwnerName;
          detailObj.tokenOwnerType = t.tokenOwnerType;
          detailObj.cartingCarryForward = t.cartingCarryForward;

          if (t.tokenOwnerType === "another") {
            detailObj.anotherTokenOwnerName = t.anotherTokenOwnerName;
            detailObj.tokenOwnerRate = t.tokenOwnerRate;
            detailObj.totalTokenOwnerAmount = t.totalTokenOwnerAmount;
            detailObj.tokenOwnerCarryForward = t.tokenOwnerCarryForward;
          }
        }

        paymentDetails.push(detailObj);
      }
    }

    if (remainingPayment > 0 && tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1];
      lastToken.paidAmount = Number(lastToken.paidAmount || 0) + remainingPayment;
      lastToken.confirmedAt = new Date();
    }

    const currentTokenObj = tokens.find(t => t.id === Number(tokenId));
    if (currentTokenObj) {
      currentTokenObj.cartingPaidAmount = Number(currentTokenObj.cartingPaidAmount || 0) + Number(cartingPaidAmount || 0);
      currentTokenObj.tokenOwnerPaidAmount = Number(currentTokenObj.tokenOwnerPaidAmount || 0) + Number(tokenOwnerPaidAmount || 0);
      currentTokenObj.confirmedAt = new Date();
    }

    await tokenRepo.save(tokens);

    if (currentTokenObj) {
      await syncLedgersAndStatuses(currentTokenObj, adminId);
    }

    const detailsPayload: any = {
      confirmedTokens: paymentDetails,
      advanceLeft: remainingPayment > 0 ? remainingPayment : 0,
    };

    if (token.materialType === "bedash") {
      detailsPayload.cartingPaidThisTime = Number(cartingPaidAmount || 0);
      if (token.tokenOwnerType === "another") {
        detailsPayload.ownerPaidThisTime = Number(tokenOwnerPaidAmount || 0);
      }
    }

    const history = paymentHistoryRepo.create({
      user: token.user,
      admin: { id: currentUser.id } as any,
      type: "token_payment",
      amount: paidAmount,
      details: detailsPayload,
    });
    await paymentHistoryRepo.save(history);

    const adminUser = token.user.role === "user" ? token.user.creator : token.user;
    const adminPhone = (adminUser as any)?.phone;

    (async () => {
      try {
        const absoluteLatestToken = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c").where("t.customerName = :customerName", { customerName: token.customerName }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId }).orderBy("t.id", "DESC").getOne();
        const actualFinalCarry = absoluteLatestToken ? Number(absoluteLatestToken.carryForward) : 0;
        const netCarryText = actualFinalCarry < 0 ? `₹${Math.abs(actualFinalCarry)} (TOTAL DUE / BAKI)` : `₹${actualFinalCarry} (TOTAL ADVANCE)`;

        const fullyClearedTokens = paymentDetails.filter((p) => p.isFullyCleared);
        const partiallyPaidTokens = paymentDetails.filter((p) => !p.isFullyCleared);

        let paymentBreakdownText = `\n💳 *Payment Settlement Breakdown:*\n`;
        if (fullyClearedTokens.length > 0) {
          paymentBreakdownText += `\n✅ *Fully Cleared Tokens:*\n`;
          fullyClearedTokens.forEach((p) => { paymentBreakdownText += `• 🎫 Token #${p.tokenId} (${p.materialType}): ₹${p.paidThisTime} received (Total ₹${p.totalAmount} Cleared)\n`; });
        }
        if (partiallyPaidTokens.length > 0) {
          paymentBreakdownText += `\n⏳ *Partially Cleared (Still Pending):*\n`;
          partiallyPaidTokens.forEach((p) => {
            paymentBreakdownText += `• 🎫 Token #${p.tokenId} (${p.materialType}):\n   Bill: ₹${p.totalAmount} | Received: ₹${p.paidThisTime}\n   Total Paid: ₹${p.totalPaidNow} | *Baki Due: ₹${p.dueNow}*\n`;
          });
        }
        if (remainingPayment > 0) {
          paymentBreakdownText += `\n🎁 *Extra Advance Deposited:* ₹${remainingPayment}\n`;
        }

        const allDealersTokensSummary = await buildCustomerAllDealersTokensSummary(token.customerName, adminId);
        const confirmMsg = `💰 *Payment Received & Account Balanced!* 💰\n\n👤 Customer: *${token.customerName}*\n📅 Date: ${new Date().toLocaleDateString("en-GB")}\n💵 *Total Amount Paid:* ₹${paidAmount}\n` + paymentBreakdownText + `\n📌 *CUSTOMER FINAL ACCOUNT BALANCE:*\n👉 *${netCarryText}*\n` + allDealersTokensSummary + `\nThank you for prompt settlement! - Bricks Admin`;

        if (token.customerPhone) await sendWhatsAppReceipt(token.customerPhone, confirmMsg, adminId);

        if (adminPhone) {
          const allDealerCustomersReport = await buildAllCustomersTokensForDealer(token.user.id);
          const adminConfirmMsg = `💰 *Admin Alert: Payment Received* 💰\n\n👤 Dealer: *${token.user.name}*\n👤 Customer: *${token.customerName}*\n💵 Paid Amount: *₹${paidAmount}*\n📌 Customer Final Net Balance: *${netCarryText}*\n` + allDealerCustomersReport + `- Bricks Admin Automated System`;
          
          await sendWhatsAppReceipt(adminPhone, adminConfirmMsg, adminId);
        }
      } catch (waErr) {
        console.error("WhatsApp delivery failed on confirm payment:", waErr);
      }
    })();

    return res.json({ msg: "✅ Ledger balanced and payment recorded in History", customerName: token.customerName });
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

    if (currentUser.role === "user" && currentUser.id !== targetUser.id) return res.status(403).json({ msg: "Access denied" });
    if (currentUser.role === "admin" && targetUser.creator?.id !== currentUser.id) return res.status(403).json({ msg: "Access denied: Not your user" });

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

    if (currentUser.role === "user") return res.status(403).json({ msg: "Access denied" });

    let users: User[] = [];
    if (currentUser.role === "superadmin") users = await userRepo.find({ where: { role: "user" } });
    else users = await userRepo.find({ where: { role: "user", creator: { id: currentUser.id } } });

    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return res.json({ msg: "✅ Admin token report fetched", totalTokens: 0, data: [] });

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
      cartingOwnerName: t.cartingOwnerName,
      cartingOwnerPhone: t.cartingOwnerPhone,
      tokenOwnerType: t.tokenOwnerType,
      anotherTokenOwnerName: t.anotherTokenOwnerName,
      anotherTokenOwnerPhone: t.anotherTokenOwnerPhone,
      sellRate: t.sellRate,
      cartingRate: t.cartingRate,
      totalCarting: t.totalCarting,
      tokenOwnerRate: t.tokenOwnerRate,
      totalTokenOwnerAmount: t.totalTokenOwnerAmount,
      cartingPaidAmount: t.cartingPaidAmount,
      cartingCarryForward: t.cartingCarryForward,
      tokenOwnerPaidAmount: t.tokenOwnerPaidAmount,
      tokenOwnerCarryForward: t.tokenOwnerCarryForward,
    }));

    return res.json({ msg: "✅ Admin token report fetched", totalTokens: table.length, data: table });
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

    const tokens = await tokenRepo.find({ where: { user: { id: user.id } }, order: { id: "DESC" } });
    const accounts = await accountRepo.find({ where: { user: { id: user.id } } });

    const adminUser = user.role === "user" ? user.creator : user;
    const adminPhone = (user as any).phone || (adminUser as any)?.phone;
    const adminId = adminUser?.id || currentUser.id;

    if (!adminPhone) return res.status(400).json({ msg: "❌ User phone number not found for WhatsApp" });

    // ⭐ Naya Free WhatsApp Admin ID parameter pass kiya gaya hai
    await generateAndSendUserReportPDF(user, tokens, accounts, {
      adminId: adminId,
      phone: adminPhone,
    });

    return res.json({ msg: "📄 PDF Report successfully generated and sent to WhatsApp!" });
  } catch (error) {
    console.error("Error sending PDF report:", error);
    return res.status(500).json({ msg: "Server error while sending PDF report" });
  }
};