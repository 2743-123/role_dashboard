import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity()
export class BlacklistToken {
  @PrimaryGeneratedColumn()
  id!: number;

  // ⚡ Index lagaya lookup fast karne ke liye
  // ⚡ "text" ko pehla argument banaya taaki TypeScript error na de
  @Index()
  @Column("text", { 
    unique: true, 
    nullable: true // 🛡️ Database safety ke liye taaki purane data par error na aaye
  })
  token!: string;

  @CreateDateColumn()
  createdAt!: Date;
}