"use client";

import PageLoading from "@/components/motion/PageLoading";
import { useAuth } from "@/components/AuthProvider";
import TeamHub from "@/components/team/TeamHub";

export default function TeamListPage() {
  const { loading } = useAuth();
  if (loading) return <PageLoading />;
  return <TeamHub />;
}
