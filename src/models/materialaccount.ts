import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";

// Helper function to maintain consistency with Token & Transaction entities
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class MaterialAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  // 🐛 FIX 1: Strict Enum for database protection
  @Column({ 
  type: "enum", 
  enum: ["flyash", "bedash"],
  default: "flyash",
  nullable: true // 👈 Isey add karein taaki purane khali records error na dein
})
materialType!: "flyash" | "bedash";

  // 🐛 FIX 2: Changed 'float' to 'numeric' with precision to prevent rounding errors
  @Column({
    type: "numeric",
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  totalTons!: number;

  @Column({
    type: "numeric",
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  usedTons!: number;

  @Column({
    type: "numeric",
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  remainingTons!: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.accounts, { onDelete: "CASCADE" })
  user!: User;
}