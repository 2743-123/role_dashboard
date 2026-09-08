import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";

import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { PaymentHistory } from "../models/PaymentHistory";

const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const userRepo = AppDataSource.getRepository(User);
const paymentHistoryRepo = AppDataSource.getRepository(PaymentHistory);

export const createToken = async (req: Request, res: Response) => {
  try {
    const { customerName, materialType, userId } = req.body;

    const user = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const adminId = user.role === "user" ? user.creator?.id : user.id;

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

    if (["admin", "superadmin"].includes(currentUser.role)) {
      const newUser = await userRepo.findOne({ where: { id: userId }, relations: ["creator"] });
      if (!newUser) return res.status(404).json({ msg: "Target user not found" });
      targetUser = newUser;
    }

    /** Material Account Update */
    const account = await accountRepo.findOne({
      where: { user: { id: targetUser.id }, materialType: token.materialType },
    });

    if (!account) return res.status(400).json({ msg: "Material account not found" });

    const oldWeight = Number(token.weight || 0);
    const newWeight = Number(weight);
    const diff = newWeight - oldWeight;

    if (diff > 0 && diff > account.remainingTons) {
      return res.status(400).json({
        msg: `Insufficient balance. Available: ${account.remainingTons}`,
      });
    }

    account.usedTons = Math.max(0, Number(account.usedTons) + diff);
    account.remainingTons = Number(account.remainingTons) - diff;
    await accountRepo.save(account);

    /** 🟢 Billing Calculation FIX */
    const ratePerTon = 180;
    
    const finalTotalAmount = totalAmount !== undefined 
      ? Number(totalAmount) 
      : (newWeight * ratePerTon + Number(commission));
    
    const adminId = targetUser.role === "user" ? targetUser.creator?.id : targetUser.id;

    /** Update current token basics */
    token.user = targetUser;
    token.truckNumber = truckNumber;
    token.weight = newWeight;
    token.commission = Number(commission);
    token.ratePerTon = ratePerTon;
    token.totalAmount = finalTotalAmount;
    
    if (manualDate) {
      token.updatedAt = new Date(manualDate); 
    }
    
    await tokenRepo.save(token);

    // 🔥 RE-CALCULATE LEDGER CHAIN FOR THIS AND ALL NEXT TOKENS
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

      // ✅ Golden Rule of Ledger
      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;
      
      if (tTotal > 0) {
        t.status = runningCarry >= 0 ? "completed" : "updated";
      }
    }

    if (allRelevantTokens.length > 0) {
      await tokenRepo.save(allRelevantTokens);
    }

    return res.json({
      msg: "✅ Token updated with perfectly balanced ledger chain",
      data: token,
    });
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
      // ⭐ ADDED MISSING FIELDS FROM getAllTokens
      totalAmount: t.totalAmount,
      commission: t.commission,
      ratePerTon: t.ratePerTon,
      paidAmount: t.paidAmount,
      // =========================================
      carryForward: t.carryForward,
      status: t.status,
      userId: t.user.id,
      userName: t.user.name,
      remainingTons: getRemaining(t.user.id, t.materialType),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt, // ⭐ Also added updatedAt for the new UI table
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

    await tokenRepo.remove(token);

    return res.json({ msg: "🗑️ Pending token deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};