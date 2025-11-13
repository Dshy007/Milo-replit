import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { TimePicker } from "@/components/TimePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formSpecialRequestSchema } from "@shared/schema";
import { format, parseISO, isSameDay } from "date-fns";
import { CalendarIcon, CheckCircle2, XCircle, Clock, AlertCircle, User, Calendar as CalendarCheck, Repeat, Trash2, HelpCircle, ChevronRight, ChevronLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { z } from "zod";
import type { SpecialRequest, Driver, Block, Contract } from "@shared/schema";

type FormValues = z.infer<typeof formSpecialRequestSchema>;

type RequestType = "full_day" | "recurring_days" | "time_window";

// Individual contract time option for display
type ContractTimeOption = {
  startTime: string;
  blockType: "solo1" | "solo2" | "team";
  blockTypeLabel: string;
  contract: Contract; // Single contract, not array
};

// Helper function to convert military time to AM/PM
function convertTo12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

export default function SpecialRequests() {
  const [selectedRequest, setSelectedRequest] = useState<SpecialRequest | null>(null);
  const [showSwapCandidates, setShowSwapCandidates] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [requestType, setRequestType] = useState<RequestType>("full_day");
  const [selectedContractTime, setSelectedContractTime] = useState<string>("");
  const [useMilitaryTime, setUseMilitaryTime] = useState(true);
  const { toast } = useToast();

  const { data: requests, isLoading: requestsLoading } = useQuery<SpecialRequest[]>({
    queryKey: ["/api/special-requests"],
  });

  const { data: drivers } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: blocks } = useQuery<Block[]>({
    queryKey: ["/api/blocks"],
  });

  const { data: contracts } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // Normalize contract type to lowercase
  const normalizeBlockType = (type: string): "solo1" | "solo2" | "team" => {
    const normalized = type.toLowerCase();
    if (normalized === "solo1" || normalized === "solo2" || normalized === "team") {
      return normalized as "solo1" | "solo2" | "team";
    }
    // Fallback for unexpected values
    return "solo1";
  };

  // Show individual contracts in order (not grouped)
  const contractTimeOptions: ContractTimeOption[] = (() => {
    if (!contracts) return [];
    
    // Map each contract to an option
    const options: ContractTimeOption[] = contracts.map(contract => {
      const blockType = normalizeBlockType(contract.type);
      const blockTypeLabel = blockType === "solo1" ? "Solo 1" : 
                             blockType === "solo2" ? "Solo 2" : "Team";
      return {
        startTime: contract.startTime,
        blockType,
        blockTypeLabel,
        contract
      };
    });
    
    // Sort by block type, then by time, then by tractor
    return options.sort((a, b) => {
      const typeOrder = { solo1: 1, solo2: 2, team: 3 };
      if (a.blockType !== b.blockType) {
        return typeOrder[a.blockType] - typeOrder[b.blockType];
      }
      if (a.startTime !== b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      // Sort by tractor ID (extract number from "Tractor_X")
      const getTractorNum = (opt: ContractTimeOption) => {
        const match = opt.contract.tractorId?.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
      };
      return getTractorNum(a) - getTractorNum(b);
    });
  })();

  // Get selected contract from contractId key
  const selectedContract = (() => {
    if (!selectedContractTime) return null;
    const option = contractTimeOptions.find(opt => 
      opt.contract.id === selectedContractTime
    );
    return option?.contract || null;
  })();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSpecialRequestSchema),
    defaultValues: {
      availabilityType: "unavailable",
      driverId: "",
      startDate: new Date().toISOString() as any,
      endDate: new Date().toISOString() as any,
      startTime: undefined,
      endTime: undefined,
      blockType: undefined,
      contractId: undefined,
      isRecurring: false,
      recurringPattern: undefined,
      recurringDays: [],
      reason: "",
      notes: undefined,
      // Backend will set these automatically
      // status: "pending" (default in backend)
      // requestedAt: new Date() (default in backend)
      // Legacy fields for backward compatibility
      requestType: undefined,
      affectedDate: undefined,
      affectedBlockId: undefined,
      swapCandidateId: undefined,
    },
  });

  // Sync selectedContractTime with contractId from form
  const formContractId = form.watch("contractId");
  
  useEffect(() => {
    if (formContractId && formContractId !== selectedContractTime) {
      setSelectedContractTime(formContractId);
    } else if (!formContractId && selectedContractTime !== "") {
      setSelectedContractTime("");
    }
  }, [formContractId, selectedContractTime]);

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return await apiRequest("POST", "/api/special-requests", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/special-requests"] });
      toast({ title: "Request submitted successfully" });
      setShowSubmitForm(false);
      setShowWizard(false);
      setWizardStep(1);
      form.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to submit request", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, swapCandidateId, notes }: { id: string; swapCandidateId?: string; notes?: string }) => {
      return await apiRequest("PATCH", `/api/special-requests/${id}/approve`, { swapCandidateId, notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/special-requests"] });
      toast({ title: "Request approved" });
      setSelectedRequest(null);
      setShowSwapCandidates(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to approve request", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      return await apiRequest("PATCH", `/api/special-requests/${id}/reject`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/special-requests"] });
      toast({ title: "Request rejected" });
      setSelectedRequest(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to reject request", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/special-requests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/special-requests"] });
      toast({ title: "Request cancelled successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to cancel request", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const onSubmit = (data: FormValues) => {
    // Validate contract time selection for recurring_days and time_window types
    if (requestType === "recurring_days" || requestType === "time_window") {
      if (!data.startTime || !data.blockType) {
        toast({
          title: "Contract time required",
          description: "Please select a contract start time for this request type",
          variant: "destructive"
        });
        return;
      }
    }
    
    createMutation.mutate(data);
  };

  const pendingRequests = requests?.filter(r => r.status === "pending") || [];
  const approvedRequests = requests?.filter(r => r.status === "approved") || [];
  const rejectedRequests = requests?.filter(r => r.status === "rejected") || [];

  const getStatusBadge = (status: string | null) => {
    if (!status) return <Badge variant="secondary">Unknown</Badge>;
    switch (status) {
      case "pending":
        return <Badge variant="secondary" data-testid={`badge-status-pending`}><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid={`badge-status-approved`}><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" data-testid={`badge-status-rejected`}><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return null;
    }
  };

  const getAvailabilityBadge = (availabilityType: string | null | undefined) => {
    if (availabilityType === "available") {
      return <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid={`badge-type-available`}><CheckCircle2 className="w-3 h-3 mr-1" />Available</Badge>;
    } else if (availabilityType === "unavailable") {
      return <Badge variant="destructive" data-testid={`badge-type-unavailable`}><XCircle className="w-3 h-3 mr-1" />Unavailable</Badge>;
    }
    return null;
  };

  const getRecurringBadge = (request: SpecialRequest) => {
    if (!request.isRecurring) return null;
    
    const days = request.recurringDays;
    const dayLabels = days?.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ");
    
    return (
      <Badge variant="outline" data-testid={`badge-recurring`}>
        <Repeat className="w-3 h-3 mr-1" />
        {dayLabels || "Recurring"}
      </Badge>
    );
  };

  const getContractInfo = (request: SpecialRequest) => {
    if (!request.startTime || !request.blockType) return null;
    
    const blockTypeLabel = request.blockType === "solo1" ? "Solo 1" : 
                           request.blockType === "solo2" ? "Solo 2" : "Team";
    
    // Find the contract name if contractId is specified
    let contractName = null;
    if (request.contractId) {
      if (!contracts) {
        // Contracts not loaded yet - show generic message
        contractName = "Contract ID: " + request.contractId.slice(0, 8);
      } else {
        const contract = contracts.find(c => c.id === request.contractId);
        contractName = contract?.name || "Unknown Contract";
      }
    }
    
    // Display format: "20:30 • Any tractor (Solo 1)" or "20:30 • Tractor_8"
    const timeDisplay = useMilitaryTime ? request.startTime : convertTo12Hour(request.startTime);
    const tractorInfo = contractName || "Any tractor";
    
    return `${timeDisplay} • ${tractorInfo} (${blockTypeLabel})`;
  };

  const getDateDisplay = (request: SpecialRequest) => {
    const startDate = request.startDate || request.affectedDate;
    const endDate = request.endDate;
    const startTime = request.startTime;
    const endTime = request.endTime;
    
    if (!startDate) return "No date";
    
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    
    // Convert times to 12-hour format for display
    const formattedStartTime = startTime ? convertTo12Hour(startTime) : null;
    const formattedEndTime = endTime ? convertTo12Hour(endTime) : null;
    
    // Same day or single day
    if (!end || isSameDay(start, end)) {
      // If we have time information
      if (formattedStartTime) {
        if (formattedEndTime && formattedEndTime !== formattedStartTime) {
          return `${format(start, "PPP")} at ${formattedStartTime} - ${formattedEndTime}`;
        }
        return `${format(start, "PPP")} at ${formattedStartTime}`;
      }
      // Legacy: date only
      return format(start, "PPP");
    }
    
    // Multi-day range
    if (formattedStartTime) {
      const startDisplay = `${format(start, "PPP")} at ${formattedStartTime}`;
      const endDisplay = formattedEndTime ? `${format(end, "PPP")} at ${formattedEndTime}` : format(end, "PPP");
      return `${startDisplay} - ${endDisplay}`;
    }
    
    // Legacy: dates only
    return `${format(start, "PPP")} - ${format(end, "PPP")}`;
  };

  const getDriverName = (driverId: string | null) => {
    if (!driverId) return "Unknown Driver";
    const driver = drivers?.find(d => d.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : "Unknown Driver";
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Special Requests</h1>
          <p className="text-muted-foreground">Manage time-off requests, shift swaps, and schedule changes</p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              setWizardStep(1);
              setShowWizard(true);
            }} 
            data-testid="button-wizard-mode"
            className="text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            Need help? Try Step-by-Step mode
          </Button>
          <Button onClick={() => setShowSubmitForm(true)} data-testid="button-new-request">
            Submit New Request
          </Button>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pendingRequests.length})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Approved ({approvedRequests.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            Rejected ({rejectedRequests.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4 mt-6">
          {requestsLoading ? (
            <div className="text-center py-12">Loading...</div>
          ) : pendingRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground">No pending requests</p>
              </CardContent>
            </Card>
          ) : (
            pendingRequests.map((request) => (
              <Card key={request.id} data-testid={`card-request-${request.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle>{getDriverName(request.driverId)}</CardTitle>
                        {getStatusBadge(request.status)}
                        {getAvailabilityBadge(request.availabilityType)}
                        {getRecurringBadge(request)}
                      </div>
                      <CardDescription>
                        Requested on {format(new Date(request.requestedAt), "PPP")}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setSelectedRequest(request);
                          if (request.affectedBlockId) {
                            setShowSwapCandidates(true);
                          } else {
                            approveMutation.mutate({ id: request.id });
                          }
                        }}
                        data-testid={`button-approve-${request.id}`}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => rejectMutation.mutate({ id: request.id })}
                        data-testid={`button-reject-${request.id}`}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                      <span>{getDateDisplay(request)}</span>
                    </div>
                    {getContractInfo(request) && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{getContractInfo(request)}</span>
                      </div>
                    )}
                    {request.reason && (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span>Reason: {request.reason.charAt(0).toUpperCase() + request.reason.slice(1).replace(/_/g, " ")}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="approved" className="space-y-4 mt-6">
          {approvedRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground">No approved requests</p>
              </CardContent>
            </Card>
          ) : (
            approvedRequests.map((request) => (
              <Card key={request.id} data-testid={`card-request-${request.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle>{getDriverName(request.driverId)}</CardTitle>
                        {getStatusBadge(request.status)}
                        {getAvailabilityBadge(request.availabilityType)}
                        {getRecurringBadge(request)}
                      </div>
                      <CardDescription>
                        Approved on {request.reviewedAt ? format(new Date(request.reviewedAt), "PPP") : "N/A"}
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate(request.id)}
                      data-testid={`button-cancel-${request.id}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                      <span>{getDateDisplay(request)}</span>
                    </div>
                    {getContractInfo(request) && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{getContractInfo(request)}</span>
                      </div>
                    )}
                    {request.reason && (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span>Reason: {request.reason.charAt(0).toUpperCase() + request.reason.slice(1).replace(/_/g, " ")}</span>
                      </div>
                    )}
                    {request.notes && (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span>Notes: {request.notes}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="rejected" className="space-y-4 mt-6">
          {rejectedRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground">No rejected requests</p>
              </CardContent>
            </Card>
          ) : (
            rejectedRequests.map((request) => (
              <Card key={request.id} data-testid={`card-request-${request.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle>{getDriverName(request.driverId)}</CardTitle>
                        {getStatusBadge(request.status)}
                        {getAvailabilityBadge(request.availabilityType)}
                        {getRecurringBadge(request)}
                      </div>
                      <CardDescription>
                        Rejected on {request.reviewedAt ? format(new Date(request.reviewedAt), "PPP") : "N/A"}
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate(request.id)}
                      data-testid={`button-delete-${request.id}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                      <span>{getDateDisplay(request)}</span>
                    </div>
                    {getContractInfo(request) && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{getContractInfo(request)}</span>
                      </div>
                    )}
                    {request.reason && (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span>Reason: {request.reason.charAt(0).toUpperCase() + request.reason.slice(1).replace(/_/g, " ")}</span>
                      </div>
                    )}
                    {request.notes && (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span>Notes: {request.notes}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showSubmitForm} onOpenChange={setShowSubmitForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-submit-request">
          <DialogHeader>
            <DialogTitle>Driver Availability</DialogTitle>
            <DialogDescription>Manage driver time-off and recurring unavailability patterns</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Driver Selection */}
              <FormField
                control={form.control}
                name="driverId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Driver</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-driver">
                          <SelectValue placeholder="Select driver" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {drivers?.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.firstName} {driver.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Request Type Selector */}
              <div className="space-y-4">
                <FormLabel>Request Type</FormLabel>
                <ToggleGroup
                  type="single"
                  value={requestType}
                  onValueChange={(value) => {
                    if (value) {
                      setRequestType(value as RequestType);
                      // Reset all time/contract related fields first
                      setSelectedContractTime("");
                      
                      // Reset relevant form fields when changing type
                      if (value === "full_day") {
                        form.setValue("startTime", undefined);
                        form.setValue("endTime", undefined);
                        form.setValue("blockType", undefined);
                        form.setValue("contractId", undefined);
                        form.setValue("isRecurring", false);
                        form.setValue("recurringDays", []);
                        form.setValue("recurringPattern", undefined);
                      } else if (value === "recurring_days") {
                        form.setValue("isRecurring", true);
                        form.setValue("endTime", undefined);
                        form.setValue("recurringPattern", "custom");
                        // Keep blockType, contractId, startTime - user will select these
                      } else if (value === "time_window") {
                        form.setValue("isRecurring", false);
                        form.setValue("recurringDays", []);
                        form.setValue("recurringPattern", undefined);
                        // Keep blockType, contractId, startTime, endTime - user will select these
                      }
                    }
                  }}
                  className="grid grid-cols-3 gap-2"
                  data-testid="toggle-request-type"
                >
                  <ToggleGroupItem value="full_day" aria-label="Full Day Off" className="flex flex-col items-center gap-1 h-auto py-3" data-testid="toggle-full-day">
                    <CalendarCheck className="w-5 h-5" />
                    <span className="text-sm">Full Day Off</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="recurring_days" aria-label="Recurring Days Off" className="flex flex-col items-center gap-1 h-auto py-3" data-testid="toggle-recurring-days">
                    <Repeat className="w-5 h-5" />
                    <span className="text-sm">Recurring Days</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="time_window" aria-label="Time Window" className="flex flex-col items-center gap-1 h-auto py-3" data-testid="toggle-time-window">
                    <Clock className="w-5 h-5" />
                    <span className="text-sm">Time Window</span>
                  </ToggleGroupItem>
                </ToggleGroup>
                <FormDescription>
                  {requestType === "full_day" && "Request a full day off from work"}
                  {requestType === "recurring_days" && "Set recurring days off (e.g., every Friday)"}
                  {requestType === "time_window" && "Request specific time window unavailability"}
                </FormDescription>
              </div>

              <Separator />

              {/* Availability Type */}
              <FormField
                control={form.control}
                name="availabilityType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Availability Type</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        type="single"
                        value={field.value || "unavailable"}
                        onValueChange={(value) => {
                          if (value) field.onChange(value);
                        }}
                        className="justify-start gap-2"
                        data-testid="toggle-availability-type"
                      >
                        <ToggleGroupItem
                          value="available"
                          aria-label="Available"
                          className="data-[state=on]:bg-green-600 data-[state=on]:text-white"
                          data-testid="toggle-available"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Available
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          value="unavailable"
                          aria-label="Unavailable"
                          className="data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground"
                          data-testid="toggle-unavailable"
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Unavailable
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <FormLabel>Date Range</FormLabel>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Start Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-select-start-date"
                              >
                                {field.value ? format(field.value, "PPP") : <span>Pick start date</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={(date) => {
                                if (date) {
                                  const isoString = date.toISOString();
                                  field.onChange(isoString);
                                  const endDate = form.getValues("endDate");
                                  if (!endDate || new Date(isoString) > new Date(endDate)) {
                                    form.setValue("endDate", isoString as any);
                                  }
                                }
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>End Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-select-end-date"
                              >
                                {field.value ? format(field.value, "PPP") : <span>Pick end date</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={(date) => {
                                if (date) {
                                  field.onChange(date.toISOString());
                                }
                              }}
                              disabled={(date) => {
                                const startDate = form.getValues("startDate");
                                return startDate ? date < new Date(startDate) : false;
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormDescription>
                  {requestType === "full_day" && "Select the full day(s) you'll be unavailable"}
                  {requestType === "recurring_days" && "Select when the recurring pattern begins"}
                  {requestType === "time_window" && "Select the date range for this time window"}
                </FormDescription>
              </div>

              {/* Contract Time Selection - Only show for time_window or recurring_days */}
              {(requestType === "time_window" || requestType === "recurring_days") && (
                <div className="space-y-4">
                  <FormLabel>Contract Start Time</FormLabel>
                  <div className="space-y-2">
                    <Select
                      value={selectedContractTime}
                      onValueChange={(value) => {
                        setSelectedContractTime(value);
                        // Find the selected contract and set form values
                        const option = contractTimeOptions.find(opt => 
                          opt.contract.id === value
                        );
                        if (option) {
                          form.setValue("blockType", option.blockType);
                          form.setValue("startTime", option.startTime);
                          form.setValue("contractId", option.contract.id);
                        }
                      }}
                      data-testid="select-contract-time"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select contract time" />
                      </SelectTrigger>
                      <SelectContent>
                        {contractTimeOptions.map((option) => {
                          const displayTime = useMilitaryTime 
                            ? option.startTime 
                            : convertTo12Hour(option.startTime);
                          const tractorLabel = option.contract.name || option.contract.tractorId || 'N/A';
                          return (
                            <SelectItem 
                              key={option.contract.id}
                              value={option.contract.id}
                            >
                              {displayTime} • {tractorLabel} ({option.blockTypeLabel})
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={useMilitaryTime}
                        onCheckedChange={(checked) => setUseMilitaryTime(!!checked)}
                        id="military-time-toggle"
                        data-testid="checkbox-military-time"
                      />
                      <label htmlFor="military-time-toggle" className="text-sm cursor-pointer">
                        Show times in 24-hour format (20:30 instead of 8:30 PM)
                      </label>
                    </div>
                  </div>
                  <FormDescription>
                    Select a specific contract with start time and tractor assignment
                  </FormDescription>

                  {/* End Time for time_window type */}
                  {requestType === "time_window" && selectedContractTime && (
                    <FormField
                      control={form.control}
                      name="endTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>End Time (Optional)</FormLabel>
                          <FormControl>
                            <TimePicker
                              value={field.value || ""}
                              onChange={field.onChange}
                              placeholder="Select time"
                              testId="input-end-time"
                            />
                          </FormControl>
                          <FormDescription>
                            Leave blank for start time only, or set end time for a time window
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              <Separator />

              <Card className="border-2">
                <CardHeader className="pb-3">
                  <FormField
                    control={form.control}
                    name="isRecurring"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between space-y-0">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base flex items-center gap-2">
                            <Repeat className="w-4 h-4" />
                            Recurring Pattern
                          </FormLabel>
                          <FormDescription>
                            Make this a permanent schedule (e.g., "Every Friday off")
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Checkbox
                            checked={field.value || false}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-recurring"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardHeader>
                {form.watch("isRecurring") && (
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="recurringDays"
                      render={() => (
                        <FormItem>
                          <FormLabel>Select Days</FormLabel>
                          <div className="grid grid-cols-4 gap-2">
                            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                              <FormField
                                key={day}
                                control={form.control}
                                name="recurringDays"
                                render={({ field }) => {
                                  const dayValue = day.toLowerCase();
                                  return (
                                    <FormItem
                                      key={day}
                                      className="flex flex-row items-center space-x-2 space-y-0"
                                    >
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(dayValue)}
                                          onCheckedChange={(checked) => {
                                            const currentDays = field.value || [];
                                            const newDays = checked
                                              ? [...currentDays, dayValue]
                                              : currentDays.filter((d) => d !== dayValue);
                                            field.onChange(newDays);
                                            form.setValue("recurringPattern", "custom");
                                          }}
                                          data-testid={`checkbox-day-${dayValue}`}
                                        />
                                      </FormControl>
                                      <FormLabel className="text-sm font-normal cursor-pointer">
                                        {day.slice(0, 3)}
                                      </FormLabel>
                                    </FormItem>
                                  );
                                }}
                              />
                            ))}
                          </div>
                          <FormDescription>
                            Select which days of the week this pattern applies to
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                )}
              </Card>

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-reason">
                          <SelectValue placeholder="Select reason" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="vacation">Vacation</SelectItem>
                        <SelectItem value="sick_leave">Sick Leave</SelectItem>
                        <SelectItem value="personal">Personal Day</SelectItem>
                        <SelectItem value="training">Training/Education</SelectItem>
                        <SelectItem value="medical">Medical Appointment</SelectItem>
                        <SelectItem value="family">Family Emergency</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("reason") === "other" && (
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional Details</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Provide additional details..."
                          value={field.value || ""}
                          onChange={field.onChange}
                          data-testid="textarea-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowSubmitForm(false)} data-testid="button-cancel">
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit">
                  {createMutation.isPending ? "Submitting..." : "Submit"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Step-by-Step Wizard Dialog */}
      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-wizard">
          <DialogHeader>
            <DialogTitle>Step-by-Step Request Creator</DialogTitle>
            <DialogDescription>
              Step {wizardStep} of 5 - We'll guide you through creating your request
            </DialogDescription>
          </DialogHeader>

          {/* Progress Indicator */}
          <div className="space-y-2">
            <Progress value={(wizardStep / 5) * 100} className="h-2" data-testid="progress-wizard" />
            <p className="text-sm text-muted-foreground text-center">
              {wizardStep === 1 && "Choose your request type"}
              {wizardStep === 2 && "Select the driver"}
              {wizardStep === 3 && "Pick dates and times"}
              {wizardStep === 4 && "Add any additional details"}
              {wizardStep === 5 && "Review and submit"}
            </p>
          </div>

          <Separator />

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Step 1: Request Type */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <FormLabel>What type of request would you like to make?</FormLabel>
                  <ToggleGroup
                    type="single"
                    value={requestType}
                    onValueChange={(value) => {
                      if (value) {
                        setRequestType(value as RequestType);
                        setSelectedContractTime("");
                        
                        if (value === "full_day") {
                          form.setValue("startTime", undefined);
                          form.setValue("endTime", undefined);
                          form.setValue("blockType", undefined);
                          form.setValue("contractId", undefined);
                          form.setValue("isRecurring", false);
                          form.setValue("recurringDays", []);
                          form.setValue("recurringPattern", undefined);
                        } else if (value === "recurring_days") {
                          form.setValue("isRecurring", true);
                          form.setValue("endTime", undefined);
                          form.setValue("recurringPattern", "custom");
                        } else if (value === "time_window") {
                          form.setValue("isRecurring", false);
                          form.setValue("recurringDays", []);
                          form.setValue("recurringPattern", undefined);
                        }
                      }
                    }}
                    className="grid grid-cols-1 gap-3"
                    data-testid="wizard-toggle-request-type"
                  >
                    <ToggleGroupItem 
                      value="full_day" 
                      className="flex items-start gap-3 h-auto py-4 px-4 justify-start text-left"
                      data-testid="wizard-toggle-full-day"
                    >
                      <CalendarCheck className="w-6 h-6 mt-0.5" />
                      <div>
                        <div className="font-semibold">Full Day Off</div>
                        <div className="text-sm text-muted-foreground">Request a complete day off from work</div>
                      </div>
                    </ToggleGroupItem>
                    <ToggleGroupItem 
                      value="recurring_days" 
                      className="flex items-start gap-3 h-auto py-4 px-4 justify-start text-left"
                      data-testid="wizard-toggle-recurring-days"
                    >
                      <Repeat className="w-6 h-6 mt-0.5" />
                      <div>
                        <div className="font-semibold">Recurring Days Off</div>
                        <div className="text-sm text-muted-foreground">Set specific days you're unavailable each week</div>
                      </div>
                    </ToggleGroupItem>
                    <ToggleGroupItem 
                      value="time_window" 
                      className="flex items-start gap-3 h-auto py-4 px-4 justify-start text-left"
                      data-testid="wizard-toggle-time-window"
                    >
                      <Clock className="w-6 h-6 mt-0.5" />
                      <div>
                        <div className="font-semibold">Specific Time Window</div>
                        <div className="text-sm text-muted-foreground">Block out specific hours during a day</div>
                      </div>
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}

              {/* Step 2: Driver Selection */}
              {wizardStep === 2 && (
                <FormField
                  control={form.control}
                  name="driverId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Which driver is this request for?</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="wizard-select-driver">
                            <SelectValue placeholder="Select driver" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {drivers?.map((driver) => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.firstName} {driver.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the driver who needs time off or has a scheduling request
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Step 3: Date/Time Selection */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Start Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  data-testid="wizard-button-start-date"
                                >
                                  {field.value ? format(field.value, "PPP") : <span>Pick start date</span>}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value ? new Date(field.value) : undefined}
                                onSelect={(date) => {
                                  if (date) {
                                    const isoString = date.toISOString();
                                    field.onChange(isoString);
                                    const endDate = form.getValues("endDate");
                                    if (!endDate || new Date(isoString) > new Date(endDate)) {
                                      form.setValue("endDate", isoString as any);
                                    }
                                  }
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="endDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>End Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  data-testid="wizard-button-end-date"
                                >
                                  {field.value ? format(field.value, "PPP") : <span>Pick end date</span>}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value ? new Date(field.value) : undefined}
                                onSelect={(date) => {
                                  if (date) {
                                    field.onChange(date.toISOString());
                                  }
                                }}
                                disabled={(date) => {
                                  const startDate = form.getValues("startDate");
                                  return startDate ? date < new Date(startDate) : false;
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {(requestType === "recurring_days" || requestType === "time_window") && (
                    <>
                      <FormLabel>Contract Start Time</FormLabel>
                      <Select
                        value={selectedContractTime}
                        onValueChange={(value) => {
                          setSelectedContractTime(value);
                          const option = contractTimeOptions.find(opt => opt.contract.id === value);
                          if (option) {
                            form.setValue("startTime", option.startTime);
                            form.setValue("blockType", option.blockType);
                            form.setValue("contractId", option.contract.id);
                          }
                        }}
                      >
                        <SelectTrigger data-testid="wizard-select-contract-time">
                          <SelectValue placeholder="Select contract start time" />
                        </SelectTrigger>
                        <SelectContent>
                          {contractTimeOptions.map((option) => {
                            const displayTime = useMilitaryTime 
                              ? option.startTime 
                              : convertTo12Hour(option.startTime);
                            const tractorLabel = option.contract.name || option.contract.tractorId || 'N/A';
                            return (
                              <SelectItem 
                                key={option.contract.id} 
                                value={option.contract.id}
                              >
                                {displayTime} • {tractorLabel} ({option.blockTypeLabel})
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </>
                  )}

                  {requestType === "time_window" && form.watch("startTime") && (
                    <FormField
                      control={form.control}
                      name="endTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>End Time</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="wizard-select-end-time">
                                <SelectValue placeholder="Select end time" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Array.from(new Set(contractTimeOptions.map(opt => opt.startTime)))
                                .sort()
                                .map((startTime) => {
                                  const displayTime = useMilitaryTime 
                                    ? startTime 
                                    : convertTo12Hour(startTime);
                                  return (
                                    <SelectItem key={startTime} value={startTime}>
                                      {displayTime}
                                    </SelectItem>
                                  );
                                })}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Select when this time window ends
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* Step 4: Additional Details */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  {requestType === "recurring_days" && (
                    <div className="space-y-3">
                      <FormLabel>Which days of the week?</FormLabel>
                      <div className="flex flex-wrap gap-2">
                        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                          <FormField
                            key={day}
                            control={form.control}
                            name="recurringDays"
                            render={({ field }) => {
                              const dayValue = day.toLowerCase();
                              return (
                                <FormItem key={day} className="flex items-center space-x-2">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(dayValue)}
                                      onCheckedChange={(checked) => {
                                        const currentDays = field.value || [];
                                        const newDays = checked
                                          ? [...currentDays, dayValue]
                                          : currentDays.filter((d) => d !== dayValue);
                                        field.onChange(newDays);
                                      }}
                                      data-testid={`wizard-checkbox-${dayValue}`}
                                    />
                                  </FormControl>
                                  <FormLabel className="cursor-pointer font-normal">{day.slice(0, 3)}</FormLabel>
                                </FormItem>
                              );
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reason (Optional)</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="wizard-select-reason">
                              <SelectValue placeholder="Select reason" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="vacation">Vacation</SelectItem>
                            <SelectItem value="sick_leave">Sick Leave</SelectItem>
                            <SelectItem value="personal">Personal</SelectItem>
                            <SelectItem value="medical_appointment">Medical Appointment</SelectItem>
                            <SelectItem value="family_emergency">Family Emergency</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Additional Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Any additional information..."
                            value={field.value || ""}
                            onChange={field.onChange}
                            data-testid="wizard-textarea-notes"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Step 5: Review */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4 space-y-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Request Type</p>
                      <p className="font-medium">
                        {requestType === "full_day" && "Full Day Off"}
                        {requestType === "recurring_days" && "Recurring Days Off"}
                        {requestType === "time_window" && "Specific Time Window"}
                      </p>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground">Driver</p>
                      <p className="font-medium">{getDriverName(form.watch("driverId"))}</p>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground">Dates</p>
                      <p className="font-medium">
                        {form.watch("startDate") && format(new Date(form.watch("startDate")), "PPP")}
                        {form.watch("endDate") && form.watch("startDate") !== form.watch("endDate") && 
                          ` - ${format(new Date(form.watch("endDate")!), "PPP")}`}
                      </p>
                    </div>
                    {form.watch("startTime") && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-sm text-muted-foreground">Time</p>
                          <p className="font-medium">
                            {useMilitaryTime ? form.watch("startTime") : convertTo12Hour(form.watch("startTime") || "")}
                            {form.watch("endTime") && ` - ${useMilitaryTime ? form.watch("endTime") : convertTo12Hour(form.watch("endTime") || "")}`}
                          </p>
                        </div>
                      </>
                    )}
                    {requestType === "recurring_days" && (form.watch("recurringDays")?.length ?? 0) > 0 && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-sm text-muted-foreground">Recurring Days</p>
                          <p className="font-medium">
                            {form.watch("recurringDays")?.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ") ?? ""}
                          </p>
                        </div>
                      </>
                    )}
                    {form.watch("reason") && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-sm text-muted-foreground">Reason</p>
                          <p className="font-medium">{form.watch("reason")?.replace(/_/g, " ")}</p>
                        </div>
                      </>
                    )}
                    {form.watch("notes") && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-sm text-muted-foreground">Notes</p>
                          <p className="font-medium">{form.watch("notes")}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between gap-2">
                <div>
                  {wizardStep > 1 && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setWizardStep(wizardStep - 1)}
                      data-testid="wizard-button-previous"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setShowWizard(false);
                      setWizardStep(1);
                    }}
                    data-testid="wizard-button-cancel"
                  >
                    Cancel
                  </Button>
                  {wizardStep < 5 ? (
                    <Button
                      type="button"
                      onClick={async () => {
                        // Validate current step before proceeding
                        let isValid = true;
                        
                        if (wizardStep === 1 && !requestType) {
                          isValid = false;
                          toast({ title: "Please select a request type", variant: "destructive" });
                        }
                        
                        if (wizardStep === 2) {
                          isValid = await form.trigger("driverId");
                        }
                        
                        if (wizardStep === 3) {
                          const fieldsToValidate: ("startDate" | "endDate" | "startTime" | "blockType")[] = ["startDate", "endDate"];
                          
                          // For recurring_days and time_window, contract time is required
                          if (requestType === "recurring_days" || requestType === "time_window") {
                            const startTime = form.getValues("startTime");
                            const blockType = form.getValues("blockType");
                            
                            if (!startTime || !blockType) {
                              isValid = false;
                              toast({ 
                                title: "Contract time required", 
                                description: "Please select a contract start time for this request type",
                                variant: "destructive" 
                              });
                            } else {
                              fieldsToValidate.push("startTime", "blockType");
                              isValid = await form.trigger(fieldsToValidate);
                            }
                          } else {
                            isValid = await form.trigger(fieldsToValidate);
                          }
                          
                          // Additional validation for time window
                          if (isValid && requestType === "time_window" && !form.getValues("endTime")) {
                            isValid = false;
                            toast({ 
                              title: "End time required", 
                              description: "Please select an end time for the time window",
                              variant: "destructive" 
                            });
                          }
                        }
                        
                        if (wizardStep === 4 && requestType === "recurring_days") {
                          const recurringDays = form.getValues("recurringDays");
                          if (!recurringDays || recurringDays.length === 0) {
                            isValid = false;
                            toast({ title: "Please select at least one day", variant: "destructive" });
                          }
                        }
                        
                        if (isValid) {
                          setWizardStep(wizardStep + 1);
                        }
                      }}
                      data-testid="wizard-button-next"
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  ) : (
                    <Button 
                      type="submit" 
                      disabled={createMutation.isPending}
                      data-testid="wizard-button-submit"
                    >
                      {createMutation.isPending ? "Submitting..." : "Submit Request"}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <SwapCandidatesDialog
        open={showSwapCandidates}
        onOpenChange={setShowSwapCandidates}
        request={selectedRequest}
        onApprove={(swapCandidateId) => {
          if (selectedRequest) {
            approveMutation.mutate({ id: selectedRequest.id, swapCandidateId });
          }
        }}
      />
    </div>
  );
}

interface SwapCandidatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: SpecialRequest | null;
  onApprove: (swapCandidateId?: string) => void;
}

function SwapCandidatesDialog({ open, onOpenChange, request, onApprove }: SwapCandidatesDialogProps) {
  const { data: candidates, isLoading } = useQuery({
    queryKey: ["/api/swap-candidates", request?.affectedBlockId],
    enabled: !!request?.affectedBlockId && open,
    queryFn: async () => {
      const response = await fetch(`/api/swap-candidates/${request?.affectedBlockId}`);
      if (!response.ok) throw new Error("Failed to fetch swap candidates");
      return response.json();
    },
  });

  if (!request) return null;

  const getWorkloadBadge = (level: string) => {
    switch (level) {
      case "ideal":
        return <Badge variant="default" className="bg-green-600 hover:bg-green-700">Ideal (4 days)</Badge>;
      case "warning":
        return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700">Overtime (5 days)</Badge>;
      case "critical":
        return <Badge variant="destructive">Overloaded (6+ days)</Badge>;
      case "underutilized":
        return <Badge variant="secondary">Underutilized (&lt;4 days)</Badge>;
      default:
        return null;
    }
  };

  const getComplianceBadge = (status: string) => {
    switch (status) {
      case "valid":
        return <Badge variant="default" className="bg-green-600 hover:bg-green-700"><CheckCircle2 className="w-3 h-3 mr-1" />Compliant</Badge>;
      case "warning":
        return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700"><AlertCircle className="w-3 h-3 mr-1" />Warning</Badge>;
      case "violation":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Violation</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-swap-candidates">
        <DialogHeader>
          <DialogTitle>Find Swap Candidates</DialogTitle>
          <DialogDescription>
            Eligible drivers for this shift, ranked by workload and compliance
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-12">Loading candidates...</div>
        ) : !candidates || candidates.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No eligible swap candidates found</p>
            <Button className="mt-4" onClick={() => onApprove()} data-testid="button-approve-without-swap">
              Approve Without Swap
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {candidates.map((candidate: any) => (
              <Card key={candidate.driver.id} data-testid={`card-candidate-${candidate.driver.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <CardTitle>
                          {candidate.driver.firstName} {candidate.driver.lastName}
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        {getComplianceBadge(candidate.complianceStatus)}
                        {getWorkloadBadge(candidate.workload.workloadLevel)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onApprove(candidate.driver.id)}
                      data-testid={`button-select-${candidate.driver.id}`}
                    >
                      Select This Driver
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Days Worked This Week</p>
                      <p className="font-semibold">{candidate.workload.daysWorked}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Hours</p>
                      <p className="font-semibold">{candidate.workload.totalHours.toFixed(1)}h</p>
                    </div>
                  </div>
                  {candidate.complianceMessages.length > 0 && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="text-sm font-semibold mb-2">Compliance Notes:</p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        {candidate.complianceMessages.map((msg: string, idx: number) => (
                          <li key={idx}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
