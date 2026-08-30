"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/Card";
import { Primary, Side, Split, Stack } from "@/components/Layout";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { useUser } from "@/lib/session";
import type { SiteNotes } from "@/lib/types";
import styles from "./page.module.css";

/* 작업장별 특이사항.
 *
 * 마이페이지의 특이사항은 내가 쓴 것만 보여줍니다. 그런데 "여기 바닥이 미끄럽다"는
 * 메모는 쓴 사람이 아니라 **다음에 그 장소에 들어갈 사람**에게 필요합니다.
 * 그래서 장소로 다시 묶어 전원이 읽을 수 있게 했습니다.
 *
 * 실시간 스트림(SSE)에 얹지 않았습니다 — 특이사항은 초 단위로 바뀌는 값이 아니고,
 * 관제 스트림에 태우면 메모 한 줄 때문에 관제 화면 전체가 다시 그려집니다. */

export default function NotesPage() {
  const user = useUser();
  const [sites, setSites] = useState<SiteNotes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getFirebaseAuth()?.currentUser?.getIdToken();
        const res = await fetch("/api/notes", {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { sites: SiteNotes[] };
        if (!alive) return;
        setSites(data.sites);
        // 메모가 있는 첫 작업장을 열어둡니다 — 빈 화면으로 시작하면
        // 어디를 눌러야 하는지 알 수 없습니다.
        setSelectedId(
          data.sites.find((s) => s.notes.length > 0)?.siteId ??
            data.sites[0]?.siteId ??
            null,
        );
      } catch {
        if (alive) setError("특이사항을 불러오지 못했어요.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => sites?.find((s) => s.siteId === selectedId) ?? null,
    [sites, selectedId],
  );

  const total = sites?.reduce((sum, s) => sum + s.notes.length, 0) ?? 0;

  return (
    <Stack>
      <Split>
        <Side>
          <Card padding={20} gap={12}>
            <CardTitle>작업장</CardTitle>
            <p className={styles.lead}>
              {sites === null
                ? "불러오는 중이에요."
                : `${sites.length}곳 · 특이사항 ${total}건`}
            </p>
            <div className={styles.siteList}>
              {(sites ?? []).map((s) => {
                const active = s.siteId === selectedId;
                return (
                  <button
                    key={s.siteId}
                    type="button"
                    className={`${styles.siteItem} ${
                      active ? styles.siteItemActive : ""
                    }`}
                    aria-pressed={active}
                    onClick={() => setSelectedId(s.siteId)}
                  >
                    <span className={styles.siteName}>{s.siteName}</span>
                    <span
                      className={`${styles.count} ${
                        s.notes.length > 0 ? styles.countHas : ""
                      }`}
                    >
                      {s.notes.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </Side>

        <Primary>
          <Card padding={24} gap={16}>
            <CardHeader>
              <CardTitle>
                {selected ? selected.siteName : "특이사항"}
              </CardTitle>
            </CardHeader>

            {error ? (
              <p className={styles.empty}>{error}</p>
            ) : sites === null ? (
              <p className={styles.empty}>불러오는 중이에요.</p>
            ) : !selected ? (
              <p className={styles.empty}>왼쪽에서 작업장을 골라주세요.</p>
            ) : selected.notes.length === 0 ? (
              <p className={styles.empty}>
                이 작업장에는 아직 남긴 특이사항이 없어요.
                <br />
                작업을 마치면 마이페이지에서 남길 수 있어요.
              </p>
            ) : (
              <div className={styles.noteList}>
                {selected.notes.map((n) => {
                  const mine = n.id.endsWith(`_${user.employeeId}`);
                  return (
                    <article
                      key={n.id}
                      className={`${styles.note} ${mine ? styles.noteMine : ""}`}
                    >
                      <div className={styles.noteHead}>
                        <span className={styles.author}>
                          {n.authorName} {n.authorRank}
                        </span>
                        {mine ? (
                          <span className={styles.mineTag}>내가 씀</span>
                        ) : null}
                        <span className={styles.when}>{n.when}</span>
                      </div>
                      <span className={styles.work}>
                        {n.workCode} {n.workTitle}
                      </span>
                      <p className={styles.body}>{n.note}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </Primary>
      </Split>
    </Stack>
  );
}
