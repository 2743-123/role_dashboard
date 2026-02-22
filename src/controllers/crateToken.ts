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
    const { customerName, materialType, userId } = req.body; // ❌ truck removed

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const adminId = user.role === "user" ? user.createdBy : user.id;

    const lastToken = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .where("t.customerName = :customerName", { customerName })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", {
        adminId,
      })
      .orderBy("t.id", "DESC")
      .getOne();

    const prevCarry = lastToken ? Number(lastToken.carryForward || 0) : 0;

    /** only ADVANCE forward */
    const carryForward = prevCarry > 0 ? prevCarry : 0;

    const token = tokenRepo.create({
      customerName,
      materialType,
      user,
      status: "pending",
      carryForward,
      paidAmount: carryForward > 0 ? carryForward : 0,
      truckNumber: undefined, // 🆕 truck later
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
    const { tokenId, userId, truckNumber, weight, commission } = req.body; // 🆕 truck added
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
      if (!newUser)
        return res.status(404).json({ msg: "Target user not found" });
      targetUser = newUser;
    }

    /** material account */
    const account = await accountRepo.findOne({
      where: { user: { id: targetUser.id }, materialType: token.materialType },
    });

    if (!account)
      return res.status(400).json({ msg: "Material account not found" });

    /** weight diff */
    const oldWeight = token.weight || 0;
    const newWeight = Number(weight);
    const diff = newWeight - oldWeight;

    const safeRemaining = Number(account.remainingTons) + oldWeight; // rollback current token weight

    if (newWeight > safeRemaining) {
      return res.status(400).json({
        msg: `Insufficient balance. Available: ${safeRemaining}`,
      });
    }

    // apply diff
    account.usedTons = account.usedTons - oldWeight + newWeight;
    account.remainingTons = safeRemaining - newWeight;

    await accountRepo.save(account);

    /** billing */
    const ratePerTon = 180;
    const totalAmount = newWeight * ratePerTon + Number(commission);

    /** previous carry */
    const adminId =
      targetUser.role === "user" ? targetUser.createdBy : targetUser.id;

    const prevToken = await tokenRepo
      .createQueryBuilder("t")
      .leftJoin("t.user", "u")
      .where("t.customerName = :customerName", {
        customerName: token.customerName,
      })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", {
        adminId,
      })
      .andWhere("t.id < :id", { id: token.id })
      .orderBy("t.id", "DESC")
      .getOne();

    const prevCarry = prevToken ? Number(prevToken.carryForward || 0) : 0;

    /** running due */
    const oldTotalAmount = Number(token.totalAmount || 0);
    const diffAmount = totalAmount - oldTotalAmount;

    // base carry choose
    const baseCarry =
      oldTotalAmount === 0
        ? prevCarry // first time update
        : Number(token.carryForward || 0); // already updated token

    const carryForward = Number((baseCarry - diffAmount).toFixed(2));

    /** 🆕 update fields */
    token.user = targetUser;
    token.truckNumber = truckNumber; // ⭐ added
    token.weight = newWeight;
    token.commission = Number(commission);
    token.ratePerTon = ratePerTon;
    token.totalAmount = totalAmount;
    token.carryForward = carryForward;
    token.status = carryForward === 0 ? "completed" : "updated";

    await tokenRepo.save(token);

    return res.json({
      msg: "✅ Token updated with truck & billing",
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

    const adminId =
      token.user.role === "user" ? token.user.createdBy : token.user.id;

    const tokens = await tokenRepo
      .createQueryBuilder("t")
      .leftJoinAndSelect("t.user", "u")
      .where("t.customerName = :customerName", {
        customerName: token.customerName,
      })
      .andWhere("(u.createdBy = :adminId OR u.id = :adminId)", {
        adminId,
      })
      .orderBy("t.id", "ASC")
      .getMany();

    let remainingPayment = Number(paidAmount);

    for (const t of tokens) {
      const total = Number(t.totalAmount || 0);

      // ⭐⭐⭐ CRITICAL FIX — skip empty tokens
      if (total <= 0) {
        await tokenRepo.save(t);
        continue;
      }

      const alreadyPaid = Number(t.paidAmount || 0);
      const due = total - alreadyPaid;

      /** 🛑 first reset carry of old tokens */
      t.carryForward = 0;

      if (remainingPayment <= 0) {
        await tokenRepo.save(t);
        continue;
      }

      if (remainingPayment >= due) {
        /** fully paid */
        t.paidAmount = total;
        t.status = "completed";
        t.confirmedAt = new Date();

        remainingPayment -= due;
      } else {
        /** partial */
        t.paidAmount = alreadyPaid + remainingPayment;
        t.carryForward = Number((t.paidAmount - total).toFixed(2)); // negative
        t.status = "updated";
        t.confirmedAt = new Date();

        remainingPayment = 0;
      }

      await tokenRepo.save(t);
    }

    /** advance case → ONLY last token */
    if (remainingPayment > 0 && tokens.length > 0) {
      const last = tokens[tokens.length - 1];

      last.carryForward = Number(remainingPayment.toFixed(2)); // positive
      last.status = "completed";
      last.confirmedAt = new Date();

      await tokenRepo.save(last);
    }

    return res.json({
      msg: "✅ Ledger perfectly balanced",
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

    return res.json({
      msg: "✅ Tokens fetched",
      count: tokens.length,
      data: tokens,
    });
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
      const acc = accounts.find(
        (a) => a.user.id === userId && a.materialType === material,
      );
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

    /** 🔐 permission check */
    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    /** 🚫 only pending token can be deleted */
    if (token.status !== "pending") {
      return res.status(400).json({
        msg: "❌ Only pending tokens can be deleted",
      });
    }

    await tokenRepo.remove(token);

    return res.json({
      msg: "🗑️ Pending token deleted successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};