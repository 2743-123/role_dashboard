import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";

@Entity()
export class MaterialAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  materialType!: "flyash" | "bedash";

  @Column("float", { default: 0 })
  totalTons!: number;

  @Column("float", { default: 0 })
  usedTons!: number;

  @Column("float", { default: 0 })
  remainingTons!: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.accounts, { onDelete: "CASCADE" })
  user!: User;
}
