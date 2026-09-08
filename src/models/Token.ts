import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./User";

// Helper function: DB numbers string ban kar aate hain, unhe waapis JS Number me badalne ke liye
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class Token {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  customerName!: string;

  @Column({ nullable: true })
  truckNumber!: string;

  // 🐛 FIX 1: Strict Enum for database protection
  @Column({ type: "enum", enum: ["flyash", "bedash"] })
  materialType!: "flyash" | "bedash";

  // 🐛 FIX 2: Added precision, scale & transformer to prevent Math/Ledger bugs
  @Column({ type: "numeric", precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  weight!: number; // Scale 3 for tons (e.g., 15.500)

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  ratePerTon!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  commission!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalAmount!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  carryForward!: number;

  // 🐛 FIX 1: Strict Enum
  @Column({
    type: "enum",
    enum: ["pending", "updated", "completed"],
    default: "pending",
  })
  status!: "pending" | "updated" | "completed";

  @CreateDateColumn()
  createdAt!: Date;

  // 🟢 NAYA ADD KIYA GAYA - Manual Date / Update Date ke liye
  @Column({ type: "timestamp", nullable: true })
  updatedAt!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  confirmedAt!: Date | null;

  @ManyToOne(() => User, (user) => user.tokens, {
    onDelete: "CASCADE", // 👈 Deletes token if user is deleted
    onUpdate: "CASCADE",
  })
  user!: User;
}