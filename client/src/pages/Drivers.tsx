import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Driver, SpecialRequest } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { baseInsertDriverSchema } from "@shared/schema";
import { z } from "zod";
import {
  Plus,
  Search,
  Upload,
  FileSpreadsheet,
  CheckCircle,
  Clock,
  XCircle,
  Calendar,
  Users,
  Truck,
  GraduationCap,
  UserMinus,
  Shield,
  Archive,
  HelpCircle,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { DriverSection } from "@/components/drivers/DriverSection";
import { DriverCard } from "@/components/drivers/DriverCard";
import { OnboardingDriverCard } from "@/components/drivers/OnboardingDriverCard";
import { DriverSummaryPills } from "@/components/drivers/DriverSummaryPills";

const driverFormSchema = baseInsertDriverSchema
  .extend({
    licenseExpiry: z.string().optional().nullable(),
    medicalCertExpiry: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
  })
  .omit({ tenantId: true });

type DriverFormData = z.infer<typeof driverFormSchema>;

type PoolStatus = "in_pool" | "onboarding" | "leaving" | "admin" | "off_roster" | "unknown";

const POOL_ORDER: readonly PoolStatus[] = [
  "in_pool",
  "onboarding",
  "leaving",
  "admin",
  "off_roster",
  "unknown",
] as const;

const POOL_LABELS: Record<PoolStatus, string> = {
  in_pool: "Active in Pool",
  onboarding: "Onboarding",
  leaving: "Leaving",
  admin: "Admin / Not Dispatching",
  off_roster: "Off Roster",
  unknown: "Unsorted (needs triage)",
};

const POOL_ICONS: Record<PoolStatus, typeof Users> = {
  in_pool: Truck,
  onboarding: GraduationCap,
  leaving: UserMinus,
  admin: Shield,
  off_roster: Archive,
  unknown: HelpCircle,
};

const POOL_DESCRIPTIONS: Record<PoolStatus, string> = {
  in_pool: "Dispatch-ready drivers actively rotating through blocks",
  onboarding: "Drivers in the 10-bucket qualification pipeline",
  leaving: "Drivers transitioning off the roster",
  admin: "Drivers in admin roles, not currently dispatching",
  off_roster: "Drivers no longer on the active roster",
  unknown: "Pool status not yet set — needs manual assignment",
};

export default function Drivers() {
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [deletingDriver, setDeletingDriver] = useState<Driver | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: driverRequests = [] } = useQuery<SpecialRequest[]>({
    queryKey: ["/api/special-requests", selectedDriver?.id],
    enabled: !!selectedDriver,
    queryFn: async () => {
      const response = await fetch(
        `/api/special-requests?driverId=${selectedDriver?.id}`
      );
      if (!response.ok) throw new Error("Failed to fetch driver requests");
      return response.json();
    },
  });

  const grouped = useMemo(() => {
    const s = search.trim().toLowerCase();
    const filtered = s
      ? drivers.filter(
          (d) =>
            `${d.firstName} ${d.lastName}`.toLowerCase().includes(s) ||
            d.email?.toLowerCase().includes(s) ||
            d.phoneNumber?.toLowerCase().includes(s) ||
            d.domicile?.toLowerCase().includes(s)
        )
      : drivers;
    const out: Record<PoolStatus, Driver[]> = {
      in_pool: [],
      onboarding: [],
      leaving: [],
      admin: [],
      off_roster: [],
      unknown: [],
    };
    for (const d of filtered) {
      const status = (d.poolStatus as PoolStatus) || "unknown";
      if (out[status]) {
        out[status].push(d);
      } else {
        out.unknown.push(d);
      }
    }
    return out;
  }, [drivers, search]);

  // Add driver form
  const addDriverForm = useForm<DriverFormData>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      licenseNumber: "",
      licenseExpiry: null,
      phoneNumber: "",
      email: "",
      domicile: "",
      profileVerified: false,
      loadEligible: true,
      status: "active",
      certifications: [],
      requiresDotCompliance: false,
    },
  });

  const addDriverMutation = useMutation({
    mutationFn: async (data: DriverFormData) => {
      return apiRequest("POST", "/api/drivers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      setAddDialogOpen(false);
      addDriverForm.reset();
      toast({
        title: "Driver added",
        description: "The driver has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add driver",
      });
    },
  });

  // Edit driver form (wired to detail modal)
  const editDriverForm = useForm<DriverFormData>({
    resolver: zodResolver(driverFormSchema),
  });

  const editDriverMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<DriverFormData> }) => {
      return apiRequest("PATCH", `/api/drivers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      setSelectedDriver(null);
      toast({
        title: "Driver updated",
        description: "The driver has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update driver",
      });
    },
  });

  const deleteDriverMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/drivers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      setDeletingDriver(null);
      setSelectedDriver(null);
      toast({
        title: "Driver deleted",
        description: "The driver has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete driver",
      });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/drivers/bulk-import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Import failed");
      }

      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      setImportDialogOpen(false);
      toast({
        title: "Import successful",
        description: `${result.imported} driver(s) imported successfully${
          result.errors?.length > 0 ? `, ${result.errors.length} errors` : ""
        }.`,
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message || "Failed to import drivers",
      });
    },
  });

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      const filenameLower = file?.name.toLowerCase();
      if (
        file &&
        (filenameLower.endsWith(".csv") ||
          filenameLower.endsWith(".xlsx") ||
          filenameLower.endsWith(".xls"))
      ) {
        bulkImportMutation.mutate(file);
      } else {
        toast({
          variant: "destructive",
          title: "Invalid file",
          description: "Please upload a CSV (.csv) or Excel (.xlsx, .xls) file",
        });
      }
    },
    [bulkImportMutation, toast]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      bulkImportMutation.mutate(file);
    }
  };

  const openDriverDetail = (driver: Driver) => {
    setSelectedDriver(driver);
    editDriverForm.reset({
      firstName: driver.firstName,
      lastName: driver.lastName,
      licenseNumber: driver.licenseNumber || "",
      licenseExpiry: driver.licenseExpiry
        ? format(new Date(driver.licenseExpiry), "yyyy-MM-dd")
        : null,
      medicalCertExpiry: driver.medicalCertExpiry
        ? format(new Date(driver.medicalCertExpiry), "yyyy-MM-dd")
        : null,
      phoneNumber: driver.phoneNumber || "",
      email: driver.email || "",
      domicile: driver.domicile || "",
      profileVerified: driver.profileVerified || false,
      loadEligible: driver.loadEligible !== undefined ? driver.loadEligible : true,
      status: driver.status,
      certifications: driver.certifications || [],
      requiresDotCompliance: driver.requiresDotCompliance || false,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading drivers...</p>
        </div>
      </div>
    );
  }

  const totalFiltered = POOL_ORDER.reduce((sum, s) => sum + grouped[s].length, 0);
  const hasResults = totalFiltered > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Drivers</h1>
          <p className="text-sm text-muted-foreground">
            Manage your driver roster across every pipeline stage
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setImportDialogOpen(true)}
            data-testid="button-import-drivers"
          >
            <Upload className="mr-2 w-4 h-4" />
            Import CSV/Excel
          </Button>
          <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-driver">
            <Plus className="mr-2 w-4 h-4" />
            Add Driver
          </Button>
        </div>
      </div>

      {/* Summary pills */}
      <DriverSummaryPills
        total={drivers.length}
        inPool={drivers.filter((d) => d.poolStatus === "in_pool").length}
        onboarding={drivers.filter((d) => d.poolStatus === "onboarding").length}
        leaving={drivers.filter((d) => d.poolStatus === "leaving").length}
        admin={drivers.filter((d) => d.poolStatus === "admin").length}
      />

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search drivers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-drivers"
          />
        </div>
      </div>

      {/* Sections */}
      {!hasResults ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {search
                ? "No drivers match your search"
                : "No drivers yet — add one or import a CSV to get started"}
            </p>
          </CardContent>
        </Card>
      ) : (
        POOL_ORDER.map((status) => {
          const list = grouped[status];
          if (list.length === 0) return null;
          return (
            <DriverSection
              key={status}
              title={POOL_LABELS[status]}
              count={list.length}
              description={POOL_DESCRIPTIONS[status]}
              icon={POOL_ICONS[status]}
              defaultOpen={status !== "off_roster" && status !== "admin"}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((d) =>
                  status === "onboarding" ? (
                    <OnboardingDriverCard
                      key={d.id}
                      driver={d}
                      onClick={() => openDriverDetail(d)}
                    />
                  ) : (
                    <DriverCard
                      key={d.id}
                      driver={d}
                      variant={
                        status === "unknown"
                          ? "in_pool"
                          : (status as "in_pool" | "leaving" | "admin" | "off_roster")
                      }
                      onClick={() => openDriverDetail(d)}
                    />
                  )
                )}
              </div>
            </DriverSection>
          );
        })
      )}

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent data-testid="dialog-import-drivers" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import Drivers</DialogTitle>
            <DialogDescription>
              Upload a CSV or Excel file to bulk import drivers
            </DialogDescription>
          </DialogHeader>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Drop files here</h3>
            <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
              data-testid="input-file-upload"
            />
            <label htmlFor="file-upload">
              <Button variant="outline" asChild>
                <span>Choose File</span>
              </Button>
            </label>
            <p className="text-xs text-muted-foreground mt-4">
              Supported formats: CSV, Excel (.xlsx, .xls)
            </p>
          </div>
          {bulkImportMutation.isPending && (
            <div className="text-center py-4">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Importing drivers...</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Driver Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="dialog-add-driver">
          <DialogHeader>
            <DialogTitle>Add New Driver</DialogTitle>
            <DialogDescription>
              Enter the driver's information. License and medical fields are optional for
              tracking.
            </DialogDescription>
          </DialogHeader>
          <Form {...addDriverForm}>
            <form
              onSubmit={addDriverForm.handleSubmit((data) => addDriverMutation.mutate(data))}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addDriverForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addDriverForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={addDriverForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        type="email"
                        data-testid="input-driver-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={addDriverForm.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        type="tel"
                        data-testid="input-phone-number"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={addDriverForm.control}
                name="domicile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Domicile</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="e.g., MKC, NYC"
                        data-testid="input-domicile"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addDriverForm.control}
                  name="profileVerified"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-profile-verified"
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        Profile Verified
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={addDriverForm.control}
                  name="loadEligible"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-load-eligible"
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        Load Eligible
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Optional Tracking Fields</h4>
                <div className="space-y-4">
                  <FormField
                    control={addDriverForm.control}
                    name="licenseNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Number</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            data-testid="input-license-number"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addDriverForm.control}
                    name="licenseExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Expiry Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-license-expiry"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addDriverForm.control}
                    name="medicalCertExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Medical Card Expiry</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-medical-cert-expiry"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddDialogOpen(false)}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addDriverMutation.isPending}
                  data-testid="button-submit-add-driver"
                >
                  {addDriverMutation.isPending ? "Adding..." : "Add Driver"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Driver Detail Modal (reuses edit dialog — Phase 2 will extract to DriverDetailModal) */}
      <Dialog
        open={!!selectedDriver}
        onOpenChange={(open) => !open && setSelectedDriver(null)}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          data-testid="dialog-driver-detail"
        >
          <DialogHeader>
            <DialogTitle>
              {selectedDriver
                ? `${selectedDriver.firstName} ${selectedDriver.lastName}`
                : "Driver"}
            </DialogTitle>
            <DialogDescription>
              Update driver information and eligibility status.
            </DialogDescription>
          </DialogHeader>
          <Form {...editDriverForm}>
            <form
              onSubmit={editDriverForm.handleSubmit((data) =>
                editDriverMutation.mutate({ id: selectedDriver!.id, data })
              )}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editDriverForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editDriverForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editDriverForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        type="email"
                        data-testid="input-edit-driver-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editDriverForm.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        type="tel"
                        data-testid="input-edit-phone-number"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editDriverForm.control}
                name="domicile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Domicile</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="e.g., MKC, NYC"
                        data-testid="input-edit-domicile"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editDriverForm.control}
                  name="profileVerified"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-edit-profile-verified"
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        Profile Verified
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={editDriverForm.control}
                  name="loadEligible"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-edit-load-eligible"
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        Load Eligible
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Optional Tracking Fields</h4>
                <div className="space-y-4">
                  <FormField
                    control={editDriverForm.control}
                    name="licenseNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Number</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            data-testid="input-edit-license-number"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={editDriverForm.control}
                    name="licenseExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Expiry Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-edit-license-expiry"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={editDriverForm.control}
                    name="medicalCertExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Medical Card Expiry</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-edit-medical-cert-expiry"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={editDriverForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="on_leave">On Leave</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {driverRequests.length > 0 && (
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="text-sm font-semibold">Special Requests</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {driverRequests
                      .filter((req) => {
                        const requestDate = req.startDate ? new Date(req.startDate) : null;
                        return (
                          requestDate &&
                          requestDate >= new Date() &&
                          (req.status === "approved" || req.status === "pending")
                        );
                      })
                      .map((request) => (
                        <div
                          key={request.id}
                          className="flex items-start justify-between gap-2 p-3 rounded-lg border bg-card"
                          data-testid={`driver-request-${request.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {request.status === "approved" && (
                                <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  Approved
                                </Badge>
                              )}
                              {request.status === "pending" && (
                                <Badge variant="secondary">
                                  <Clock className="w-3 h-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                              {request.status === "rejected" && (
                                <Badge variant="destructive">
                                  <XCircle className="w-3 h-3 mr-1" />
                                  Rejected
                                </Badge>
                              )}
                              {request.isRecurring && (
                                <Badge variant="outline">
                                  <Calendar className="w-3 h-3 mr-1" />
                                  Recurring
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm mt-1">
                              {request.startDate && format(new Date(request.startDate), "PPP")}
                              {request.endDate &&
                                request.startDate !== request.endDate &&
                                ` - ${format(new Date(request.endDate), "PPP")}`}
                            </p>
                            {request.startTime && (
                              <p className="text-xs text-muted-foreground">
                                {request.startTime}
                                {request.endTime && ` - ${request.endTime}`}
                              </p>
                            )}
                            {request.reason && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {request.reason.replace(/_/g, " ")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => selectedDriver && setDeletingDriver(selectedDriver)}
                  data-testid="button-delete-driver"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedDriver(null)}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={editDriverMutation.isPending}
                    data-testid="button-submit-edit-driver"
                  >
                    {editDriverMutation.isPending ? "Updating..." : "Save"}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingDriver}
        onOpenChange={(open) => !open && setDeletingDriver(null)}
      >
        <AlertDialogContent data-testid="dialog-delete-driver">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold">
                {deletingDriver?.firstName} {deletingDriver?.lastName}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingDriver && deleteDriverMutation.mutate(deletingDriver.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
