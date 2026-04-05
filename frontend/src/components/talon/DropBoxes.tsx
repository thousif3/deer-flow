"use client";

import { Loader2, Link as LinkIcon, Lightbulb } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function DropBoxes() {
  const [jobLink, setJobLink] = useState("");
  const [idea, setIdea] = useState("");
  const [isJobLoading, setIsJobLoading] = useState(false);
  const [isIdeaLoading, setIsIdeaLoading] = useState(false);

  const handleJobSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobLink) return;
    setIsJobLoading(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        body: JSON.stringify({ url: jobLink }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) alert("Job link queued for RAG processing.");
    } catch (error) {
      console.error("Job ingest error:", error);
    } finally {
      setIsJobLoading(false);
      setJobLink("");
    }
  };

  const handleIdeaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea) return;
    setIsIdeaLoading(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        body: JSON.stringify({ text: idea }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) alert("Idea stored in vector namespace.");
    } catch (error) {
      console.error("Idea storage error:", error);
    } finally {
      setIsIdeaLoading(false);
      setIdea("");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-5xl mx-auto p-6">
      {/* Job Link Drop Box */}
      <Card className="bg-[#111] border-[#222] hover:border-[#333] transition-all">
        <CardHeader className="flex flex-row items-center space-x-2">
          <LinkIcon className="text-blue-500 w-5 h-5" />
          <CardTitle className="text-white text-lg">Job Link Drop Box</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJobSubmit} className="space-y-4">
            <Input
              placeholder="Paste Greenhouse/Workday URL..."
              value={jobLink}
              onChange={(e) => setJobLink(e.target.value)}
              className="bg-[#050505] border-[#333] text-white focus:ring-blue-500"
            />
            <Button 
              type="submit" 
              disabled={isJobLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              {isJobLoading ? <Loader2 className="animate-spin mr-2" /> : "Ingest into Swarm"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Idea Drop Box */}
      <Card className="bg-[#111] border-[#222] hover:border-[#333] transition-all">
        <CardHeader className="flex flex-row items-center space-x-2">
          <Lightbulb className="text-yellow-500 w-5 h-5" />
          <CardTitle className="text-white text-lg">Idea Drop Box</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleIdeaSubmit} className="space-y-4">
            <Input
              placeholder="Brainstorm an AI app idea..."
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              className="bg-[#050505] border-[#333] text-white focus:ring-yellow-500"
            />
            <Button 
              type="submit" 
              disabled={isIdeaLoading}
              className="w-full bg-yellow-600 hover:bg-yellow-700 text-black font-bold"
            >
              {isIdeaLoading ? <Loader2 className="animate-spin mr-2" /> : "Store Strategy"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
