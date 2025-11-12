import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";

export default function SpecialRequests() {
  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
          <MessageSquare className="w-5 h-5 text-primary" data-testid="special-requests-icon" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
            Special Requests
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
            Manage special requests and custom requirements
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="text-muted-foreground">
            Special Requests feature coming soon...
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This page will allow you to manage special driver requests, custom route requirements, and other special accommodations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
