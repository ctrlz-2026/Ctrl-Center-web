"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/Button";
import { TextField } from "@/components/Field";
import { Logo } from "@/components/Logo";
import { useSession } from "@/lib/session";
import styles from "./page.module.css";

import type { Role } from "@/lib/types";

type Mode = "worker" | "admin";

/** 역할별 첫 화면. */
const HOME_BY_ROLE: Record<Role, string> = {
  worker: "/requests/new",
  leader: "/approvals",
  safety_admin: "/dashboard",
};

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useSession();

  const [mode, setMode] = useState<Mode>("worker");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = mode === "admin";
  const canSubmit =
    employeeId.trim().length > 0 && password.length > 0 && !busy;

  function switchMode(next: Mode) {
    setMode(next);
    setEmployeeId("");
    setPassword("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    const role = await signIn(employeeId, password);
    setBusy(false);

    if (!role) {
      // 스펙: 무엇이 틀렸는지 특정하지 않습니다.
      setError("사번 또는 비밀번호를 확인해 주세요");
      return;
    }

    setError(null);
    // 목적지는 어느 문으로 들어왔는지가 아니라 **실제 역할**이 정합니다.
    // 각 역할이 실제로 들어갈 수 있는 첫 화면으로 보냅니다 —
    // 못 들어가는 화면으로 보내면 로그인하자마자 차단 안내를 보게 됩니다.
    router.push(HOME_BY_ROLE[role]);
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.intro}>
          <Logo size="lg" className={styles.brand} />
          <h1 className={styles.title}>
            {isAdmin ? "안전관리자 로그인" : "안전 출입 관리"}
          </h1>
          <p className={styles.desc}>
            {isAdmin
              ? "안전관리자 계정으로 들어가면 관제 화면만 열려요. 작업 신청과 승인은 할 수 없어요."
              : "사번과 비밀번호로 로그인하면 역할에 맞는 화면으로 이동해요."}
          </p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.fields}>
            <TextField
              label={isAdmin ? "관리자 사번" : "사번"}
              placeholder={isAdmin ? "2011-0002" : "2019-0417"}
              autoComplete="username"
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setError(null);
              }}
            />
            <TextField
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              error={error ?? undefined}
            />
          </div>

          <Button type="submit" size="large" fullWidth disabled={!canSubmit}>
            {busy ? "확인 중" : isAdmin ? "관제 화면 열기" : "로그인"}
          </Button>
        </form>

        <div className={styles.footer}>
          <p className={styles.footnote}>계정 문의는 안전관리팀 내선 2114</p>
          <button
            type="button"
            className={styles.switch}
            onClick={() => switchMode(isAdmin ? "worker" : "admin")}
          >
            {isAdmin ? "작업자 로그인으로" : "관리자"}
          </button>
        </div>
      </div>
    </main>
  );
}
