import { Request, Response } from "express";
import { AppDataSource } from "../config/db";

import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { BedashMessage } from "../models/bedashMessage";
import { Equal } from "typeorm";

const bedashRepo = AppDataSource.getRepository(BedashMessage);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

// ✅ CREATE BEDASH ENTRY
export const createBedash = async (req: Request, res: Response) => {
  try {
    const { userId, materialType, customDate, targetDate ,amount} = req.body;
    const currentUser = (req as any).user;

    if (!["admin", "superadmin" ,"user"].includes(currentUser.role)) {
      return res
        .status(403)
        .json({ msg: "❌ Only Admin/SuperAdmin can create" });
    }

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "❌ User not found" });

    const bedash = bedashRepo.create({
      user,
      materialType: materialType as "flyash" | "bedash",
      customDate,
      targetDate,
      status: "pending",
      amount,
    });

    await bedashRepo.save(bedash);

    return res.json({
      msg: "✅ Bedash message created successfully",
      data: bedash,
    });
  } catch (err) {
    console.error("Error creating bedash:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};

// ✅ GET ALL BEDASH LIST
// export const getBedashList = async (req: Request, res: Response) => {
//   try {
//     const currentUser = (req as any).user;
//     let bedashList;

//     // SuperAdmin/Admin -> all users, normal user -> only own
//     if (["admin", "superadmin"].includes(currentUser.role)) {
//       bedashList = await bedashRepo.find({ relations: ["user"] });
//     } else {
//       bedashList = await bedashRepo.find({
//         where: { user: { id: currentUser.id } },
//         relations: ["user"],
//       });
//     }

//     // Calculate remaining tons dynamically from MaterialAccount
//     const result = await Promise.all(
//       bedashList.map(async (b) => {
//         const account = await accountRepo.findOne({
//           where: {
//             user: { id: b.user.id },
//             materialType: b.materialType as "flyash" | "bedash",
//           },
//         });

//         return {
//           id: b.id,
//           userName: b.user.name,
//           materialType: b.materialType,
//           remainingTons: account ? account.remainingTons : 0,
//           status: b.status,
//           customDate: b.customDate,
//           targetDate: b.targetDate,
//           createdAt: b.createdAt,
//         };
//       })
//     );

//     res.json(result);
//   } catch (err) {
//     console.error("Error fetching bedash list:", err);
//     res.status(500).json({ msg: "❌ Server error" });
//   }
// };
export const getBedashList = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    let bedashList;

    if (currentUser.role === "superadmin") {
      bedashList = await bedashRepo.find({ relations: ["user", "createdBy"] });
    } 
    else if (currentUser.role === "admin") {
      bedashList = await bedashRepo.find({
        where: [
          { createdBy: Equal(currentUser.id) },
          { user: { createdBy: Equal(currentUser.id) } },
        ],
        relations: ["user", "createdBy"],
      });
    } 
    else {
      bedashList = await bedashRepo.find({
        where: { user: { id: Equal(currentUser.id) } },
        relations: ["user", "createdBy"],
      });
    }

    const result = await Promise.all(
      bedashList.map(async (b) => {
        const account = await accountRepo.findOne({
          where: {
            user: { id: b.user.id },
            materialType: b.materialType as "flyash" | "bedash",
          },
        });

        return {
          id: b.id,
          userName: b.user.name,
          materialType: b.materialType,
          remainingTons: account ? account.remainingTons : 0,
          status: b.status,
          customDate: b.customDate,
          targetDate: b.targetDate,
          createdAt: b.createdAt,
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error("Error fetching bedash list:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};

// ✅ CONFIRM BEDASH (mark completed)
export const confirmBedash = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const currentUser = (req as any).user;

    if (!["admin", "superadmin"].includes(currentUser.role)) {
      return res
        .status(403)
        .json({ msg: "❌ Only Admin/SuperAdmin can confirm" });
    }

    const bedash = await bedashRepo.findOne({
      where: { id: Number(id) },
      relations: ["user"],
    });

    if (!bedash) return res.status(404).json({ msg: "❌ Not found" });

    // ✅ Update status to completed
    bedash.status = "completed";
    await bedashRepo.save(bedash);

    res.json({ msg: "✅ Bedash confirmed", data: bedash });
  } catch (err) {
    console.error("Error confirming bedash:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};
