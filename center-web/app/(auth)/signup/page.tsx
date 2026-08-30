"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/Button";
import { TextField } from "@/components/Field";
import { Logo } from "@/components/Logo";
import styles from "./page.module.css";

/* 가입 신청.
 *
 * 여기서 만들어지는 것은 계정이 아니라 **신청서**입니다. 안전관리자가 승인해야
 * 로그인할 수 있게 됩니다 — 아무나 가입해서 바로 들어오면 출입통제가 아닙니다.
 *
 * 역할은 신청서에 없습니다. 본인이 고르게 하면 자기 권한을 자기가 정하게 되므로,
 * 가입은 항상 작업자로 시작하고 승급은 관리자가 따로 합니다. */

export default function SignupPage() {
  const [empNo, setEmpNo] = useState("");
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [rank, setRank] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit =
    /^\d{9}$/.test(empNo.trim()) &&
    name.trim().length > 0 &&
    team.trim().length > 0 &&
    rank.trim().length > 0 &&
    !busy;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          empNo: empNo.trim(),
          name: name.trim(),
          team: team.trim(),
          rank: rank.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "신청을 보내지 못했어요.");
        return;
      }
      setDone(true);
    } catch {
      setError("신청을 보내지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.intro}>
          <Logo size="lg" className={styles.brand} />
          <h1 className={styles.title}>가입 신청</h1>
          <p className={styles.desc}>
            {done
              ? "신청이 접수됐어요."
              : "사번과 소속을 적어 신청하면 안전관리팀이 확인 후 계정을 만들어줘요."}
          </p>
        </div>

        {done ? (
          <>
            <div className={styles.done}>
              <span className={styles.doneTitle}>신청 완료</span>
              <p className={styles.doneBody}>
                안전관리팀이 승인하면 로그인할 수 있어요.
                <br />첫 비밀번호는 <strong>사번 뒤에 1234</strong>예요 (예:{" "}
                {empNo.trim()}1234).
              </p>
            </div>
            <Link href="/login">
              <Button size="large" fullWidth>
                로그인 화면으로
              </Button>
            </Link>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.fields}>
              <TextField
                label="사번"
                placeholder="202533690"
                inputMode="numeric"
                autoComplete="username"
                value={empNo}
                onChange={(e) => {
                  setEmpNo(e.target.value);
                  setError(null);
                }}
              />
              <TextField
                label="이름"
                placeholder="김병오"
                autoComplete="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
              />
              <div className={styles.pair}>
                <TextField
                  label="팀"
                  placeholder="생산1팀"
                  value={team}
                  onChange={(e) => {
                    setTeam(e.target.value);
                    setError(null);
                  }}
                />
                <TextField
                  label="직급"
                  placeholder="사원"
                  value={rank}
                  onChange={(e) => {
                    setRank(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            </div>

            {error ? <p className={styles.error}>{error}</p> : null}

            <Button type="submit" size="large" fullWidth disabled={!canSubmit}>
              {busy ? "보내는 중" : "가입 신청"}
            </Button>
          </form>
        )}

        {done ? null : (
          <div className={styles.footer}>
            <p className={styles.footnote}>계정 문의는 안전관리팀 내선 2114</p>
            <Link href="/login" className={styles.switch}>
              로그인
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
