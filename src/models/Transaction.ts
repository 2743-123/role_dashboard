import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from "typeorm";
import { User } from "./User";

// Helper function to safely convert DB numeric strings to JS numbers
const numericTransformer = {
  to: (data: number) => data, // Save as is to DB
  from: (data: string) => parseFloat(data), // Convert string to number when fetching
};

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn()
  id!: number;

  // Relationship with User
  @ManyToOne(() => User, (user) => user.transactions, { onDelete: "CASCADE" })
  user!: User;

  // 🐛 FIX 1: Added transformer to prevent String vs Number calculation bugs
  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalAmount!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  flyashAmount!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  bedashAmount!: number;

  @Column({ type: "numeric", precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  flyashTons!: number;

  @Column({ type: "numeric", precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  bedashTons!: number;

  // 🐛 FIX 2: Changed to 'enum' to strictly restrict DB inputs
  @Column({ type: "enum", enum: ["cash", "online"], default: "cash" })
  paymentMode!: "cash" | "online";

  // Optional fields for extra payment details
  @Column({ type: "varchar", length: 100, nullable: true })
  bankName!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  accountHolder!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  referenceNumber!: string | null;

  // Auto set when transaction is created
  @CreateDateColumn()
  createdAt!: Date;
}