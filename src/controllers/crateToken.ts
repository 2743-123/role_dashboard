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

export const createToken = async (req: Request, res: Response) => {
  try {
    const { customerName, customerPhone, materialType, userId } = req.body;

    const user = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const adminUser = user.role === "user" ? user.creator : user;
    const adminId = adminUser?.id;

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

    const account = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: token.materialType },
    });
    const remainingBalance = account ? Number(account.remainingTons).toFixed(2) : "0.00";

    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    // 🟢 CREATE MESSAGE LOGIC (Background Process)
    if (token.customerPhone) {
      (async () => {
        try {
          const message = `Hello *${token.customerName}*,\n\nYour Token has been successfully generated! 🎉\n\n📦 Material: ${token.materialType}\n👤 Issued By: *${user.name}*\n🔄 Carry Forward: ₹${token.carryForward}\n⚖️ Remaining Ton: ${remainingBalance} Tons\n⏳ Status: Pending\n\nThank you for doing business with us! - Bricks Admin`;
          await sendWhatsAppReceipt(token.customerPhone, message, waInstance, waToken);
        } catch (error) {
          console.error("WhatsApp delivery failed on create:", error);
        }
      })();
    }

    return res.json({ msg: "✅ Token created", data: token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

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

    const oldWeight = Number(token.weight || 0);
    const newWeight = Number(weight);
    const diff = newWeight - oldWeight;

    if (diff > 0 && diff > Number(account.remainingTons)) {
      return res.status(400).json({
        msg: `Insufficient balance. Available: ${account.remainingTons}`,
      });
    }

    account.usedTons = Math.max(0, Number(account.usedTons) + diff);
    account.remainingTons = Number(account.remainingTons) - diff;
    await accountRepo.save(account);

    const ratePerTon = 180;
    const finalTotalAmount =
      totalAmount !== undefined
        ? Number(totalAmount)
        : newWeight * ratePerTon + Number(commission || 0);

    const adminId = targetUser.role === "user" ? targetUser.creator?.id : targetUser.id;

    token.user = targetUser;
    token.truckNumber = truckNumber;
    token.weight = newWeight;
    token.commission = Number(commission || 0);
    token.ratePerTon = ratePerTon;
    token.totalAmount = finalTotalAmount;

    if (manualDate) {
      token.updatedAt = new Date(manualDate);
    }

    await tokenRepo.save(token);

    const allRelevantTokens = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .andWhere("t.id >= :id", { id: token.id })
      .orderBy("t.id", "ASC")
      .getMany();

    const prevTokenBeforeCurrent = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .leftJoin("u.creator", "c")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId })
      .andWhere("t.id < :id", { id: token.id })
      .orderBy("t.id", "DESC")
      .getOne();

    let runningCarry = prevTokenBeforeCurrent ? Number(prevTokenBeforeCurrent.carryForward || 0) : 0;

    for (const t of allRelevantTokens) {
      const tTotal = Number(t.totalAmount || 0);
      const tPaid = Number(t.paidAmount || 0);

      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;

      if (tTotal > 0) {
        t.status = runningCarry >= 0 ? "completed" : "updated";
      }
    }

    if (allRelevantTokens.length > 0) {
      await tokenRepo.save(allRelevantTokens);
    }

    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    // 🟠 UPDATE MESSAGE & BROADCAST LOGIC
    (async () => {
      try {
        if (token.customerPhone) {
          const customerMsg = `Hello *${token.customerName}*,\n\nYour Token has been updated! ✅\n\n🚛 Truck No: ${token.truckNumber}\n📦 Material: ${token.materialType}\n⚖️ Final Weight: ${token.weight} Tons\n💰 Total Amount: ₹${token.totalAmount}\n🔄 Carry Forward: ₹${token.carryForward}\n⏳ Status: ${token.status}\n\nThank you for business! - Bricks Admin`;
          await sendWhatsAppReceipt(token.customerPhone, customerMsg, waInstance, waToken);
        }

        const dealerPhone = (targetUser as any).phone || (targetUser as any).mobile;
        if (dealerPhone) {
          const dealerMsg = `Hello *${targetUser.name}*,\n\nA token was just updated for customer *${token.customerName}*.\n\n🚛 Truck No: ${token.truckNumber}\n📦 Material: ${token.materialType}\n⚖️ Weight Dispatched: ${token.weight} Tons\n📉 Your Remaining Balance: ${Number(account.remainingTons).toFixed(2)} Tons\n\nYou can now load the next truck accordingly.\n\n- Bricks Admin System`;
          await sendWhatsAppReceipt(dealerPhone, dealerMsg, waInstance, waToken);
        }

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
            const broadcastMsg = `🚨 *Stock Update Alert* 🚨\n\nHello *${pt.customerName}*,\n\nAnother truck was just loaded under dealer *${targetUser.name}*. The remaining stock for *${token.materialType}* is now only *${Number(account.remainingTons).toFixed(2)} Tons*.\n\nPlease check this balance before bringing your truck to load.\n\n- Bricks Admin System`;
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

    // Extract details before deletion
    const customerPhone = token.customerPhone;
    const customerName = token.customerName;
    const materialType = token.materialType;
    
    const adminUser = token.user.role === "user" ? token.user.creator : token.user;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    await tokenRepo.remove(token);

    // 🔴 DELETE MESSAGE LOGIC
    if (customerPhone) {
      (async () => {
        try {
          const cancelMsg = `Hello *${customerName}*,\n\nYour pending token for *${materialType}* has been ❌ *Cancelled/Deleted* by the administration.\n\nPlease contact your dealer for more details.\n\n- Bricks Admin`;
          await sendWhatsAppReceipt(customerPhone, cancelMsg, waInstance, waToken);
        } catch (error) {
          console.error("WhatsApp delivery failed on delete:", error);
        }
      })();
    }

    return res.json({ msg: "🗑️ Pending token deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

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
    let paymentDetails = [];

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
          dueNow: total - t.paidAmount
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
        advanceLeft: remainingPayment > 0 ? remainingPayment : 0
      }
    });
    await paymentHistoryRepo.save(history);

    return res.json({
      msg: "✅ Ledger balanced and payment recorded in History",
      customerName: token.customerName,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

export const getAllTokens = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user!;

    const targetUser = await userRepo.findOne({
      where: { id: Number(userId) },
      relations: ["creator"]
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