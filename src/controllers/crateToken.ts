import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";

import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";
import { Token } from "../models/Token";

const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const userRepo = AppDataSource.getRepository(User);

export const createToken = async (req: Request, res: Response) => {
  try {
    const { customerName, materialType, userId } = req.body;

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const adminId = user.role === "user" ? user.createdBy : user.id;

    const lastToken = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .where("t.customerName = :customerName", { customerName })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "DESC")
      .getOne();

    const prevCarry = lastToken ? Number(lastToken.carryForward || 0) : 0;

    const token = tokenRepo.create({
      customerName,
      materialType,
      user,
      status: "pending",
      carryForward: prevCarry, // ✅ Maintain ledger balance directly
      paidAmount: 0, // ✅ New token has 0 actual payment initially
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
    const { tokenId, userId, truckNumber, weight, commission } = req.body;
    const currentUser = (req as any).user;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    let targetUser = token.user;

    if (["admin", "superadmin"].includes(currentUser.role)) {
      const newUser = await userRepo.findOne({ where: { id: userId } });
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

    // Apply material differences safely
    account.usedTons = Math.max(0, Number(account.usedTons) + diff);
    account.remainingTons = Number(account.remainingTons) - diff;
    await accountRepo.save(account);

    /** Billing Calculation */
    const ratePerTon = 180;
    const totalAmount = newWeight * ratePerTon + Number(commission);
    const adminId = targetUser.role === "user" ? targetUser.createdBy : targetUser.id;

    /** Update current token basics */
    token.user = targetUser;
    token.truckNumber = truckNumber;
    token.weight = newWeight;
    token.commission = Number(commission);
    token.ratePerTon = ratePerTon;
    token.totalAmount = totalAmount;
    await tokenRepo.save(token);

    // 🔥 RE-CALCULATE LEDGER CHAIN FOR THIS AND ALL NEXT TOKENS
    const allRelevantTokens = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", { adminId })
      .andWhere("t.id >= :id", { id: token.id }) // Include current token
      .orderBy("t.id", "ASC")
      .getMany();

    const prevTokenBeforeCurrent = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", { adminId })
      .andWhere("t.id < :id", { id: token.id })
      .orderBy("t.id", "DESC")
      .getOne();

    let runningCarry = prevTokenBeforeCurrent ? Number(prevTokenBeforeCurrent.carryForward || 0) : 0;

    for (const t of allRelevantTokens) {
      const tTotal = Number(t.totalAmount || 0);
      const tPaid = Number(t.paidAmount || 0);

      // ✅ Golden Rule of Ledger: Carry = Prev Carry + Paid - Total
      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;
      
      // Update status dynamically based on dues
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
      relations: ["user"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    const adminId = token.user.role === "user" ? token.user.createdBy : token.user.id;

    const tokens = await tokenRepo
      .createQueryBuilder("t")
      .leftJoinAndSelect("t.user", "u")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", { adminId })
      .orderBy("t.id", "ASC")
      .getMany();

    let remainingPayment = Number(paidAmount);

    // 1️⃣ Distribute Payment to unpaid tokens first
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
      }
    }

    // 2️⃣ If extra payment remains (Advance), add it to the latest token
    if (remainingPayment > 0 && tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1];
      lastToken.paidAmount = Number(lastToken.paidAmount || 0) + remainingPayment;
      lastToken.confirmedAt = new Date();
    }

    // 3️⃣ Recalculate Ledger Chain for ALL tokens to fix carryForward automatically
    let runningCarry = 0;
    for (const t of tokens) {
      const tTotal = Number(t.totalAmount || 0);
      const tPaid = Number(t.paidAmount || 0);

      // Chaining logic
      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;

      // Status check
      if (tTotal > 0) {
        t.status = runningCarry >= 0 ? "completed" : "updated";
      }
    }

    await tokenRepo.save(tokens);

    return res.json({
      msg: "✅ Ledger perfectly balanced and payment distributed",
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

    if (req.user!.role === "user" && req.user!.id !== Number(userId)) {
      return res.status(403).json({ msg: "Access denied" });
    }

    const tokens = await tokenRepo.find({
      where: { user: { id: Number(userId) } },
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
        where: { role: "user", createdBy: currentUser.id },
      });
    }

    const userIds = users.map((u) => u.id);

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
      carryForward: t.carryForward,
      status: t.status,
      userId: t.user.id,
      userName: t.user.name,
      remainingTons: getRemaining(t.user.id, t.materialType),
      createdAt: t.createdAt,
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
      relations: ["user"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
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