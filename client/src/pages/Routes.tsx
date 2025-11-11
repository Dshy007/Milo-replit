import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertRouteSchema, type Route, type InsertRoute } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Search,
  MapPin,
  Navigation,
  Clock,
  Ruler
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Form schema for route creation/editing
const routeFormSchema = insertRouteSchema.omit({ tenantId: true }).extend({
  distance: z.string().optional(),
  estimatedDuration: z.string().optional(),
  notes: z.string().optional(),
});

type RouteFormData = z.infer<typeof routeFormSchema>;

export default function Routes() {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [deletingRoute, setDeletingRoute] = useState<Route | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch routes
  const { data: routes = [], isLoading } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  // Filter routes based on search
  const filteredRoutes = routes.filter((route) => {
    const query = searchQuery.toLowerCase();
    return (
      route.name.toLowerCase().includes(query) ||
      route.origin.toLowerCase().includes(query) ||
      route.destination.toLowerCase().includes(query) ||
      (route.notes && route.notes.toLowerCase().includes(query))
    );
  });

  // Add route form
  const addRouteForm = useForm<RouteFormData>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: {
      name: "",
      origin: "",
      destination: "",
      distance: "",
      estimatedDuration: "",
      notes: "",
    },
  });

  const addRouteMutation = useMutation({
    mutationFn: async (data: RouteFormData) => {
      const cleanedData = {
        ...data,
        distance: data.distance || undefined,
        estimatedDuration: data.estimatedDuration ? parseInt(data.estimatedDuration) : undefined,
        notes: data.notes || undefined,
      };
      return apiRequest("POST", "/api/routes", cleanedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setAddDialogOpen(false);
      addRouteForm.reset();
      toast({
        title: "Route created",
        description: "The route has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create route",
      });
    },
  });

  // Edit route form
  const editRouteForm = useForm<RouteFormData>({
    resolver: zodResolver(routeFormSchema),
  });

  const editRouteMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RouteFormData> }) => {
      const cleanedData = {
        ...data,
        distance: data.distance || undefined,
        estimatedDuration: data.estimatedDuration ? parseInt(data.estimatedDuration as string) : undefined,
        notes: data.notes || undefined,
      };
      return apiRequest("PATCH", `/api/routes/${id}`, cleanedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setEditingRoute(null);
      toast({
        title: "Route updated",
        description: "The route has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update route",
      });
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/routes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setDeletingRoute(null);
      toast({
        title: "Route deleted",
        description: "The route has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete route",
      });
    },
  });

  const handleAddRoute = (data: RouteFormData) => {
    addRouteMutation.mutate(data);
  };

  const handleEditRoute = (data: RouteFormData) => {
    if (editingRoute) {
      editRouteMutation.mutate({ id: editingRoute.id, data });
    }
  };

  const openEditDialog = (route: Route) => {
    setEditingRoute(route);
    editRouteForm.reset({
      name: route.name,
      origin: route.origin,
      destination: route.destination,
      distance: route.distance?.toString() || "",
      estimatedDuration: route.estimatedDuration?.toString() || "",
      notes: route.notes ?? "",
    });
  };

  const formatDuration = (minutes: number | null) => {
    if (!minutes) return "N/A";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground" data-testid="page-title">
              Routes
            </h1>
            <p className="text-muted-foreground mt-1" data-testid="page-description">
              Manage delivery routes with origin, destination, and duration details.
            </p>
          </div>
          <Button 
            onClick={() => setAddDialogOpen(true)} 
            data-testid="button-add-route"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Route
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search routes by name, origin, or destination..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-routes"
          />
        </div>

        {/* Routes Table */}
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-routes-count">
              {filteredRoutes.length} {filteredRoutes.length === 1 ? "route" : "routes"} found
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8" data-testid="loading-routes">
                <p className="text-muted-foreground">Loading routes...</p>
              </div>
            ) : filteredRoutes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4" data-testid="empty-state">
                <Navigation className="w-12 h-12 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="text-lg font-medium text-foreground">
                    {searchQuery ? "No routes found" : "No routes created yet"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {searchQuery 
                      ? "Try adjusting your search query" 
                      : "Create your first route to get started"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Origin</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Distance</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRoutes.map((route) => (
                      <TableRow key={route.id} data-testid={`row-route-${route.id}`}>
                        <TableCell className="font-medium" data-testid={`text-route-name-${route.id}`}>
                          {route.name}
                        </TableCell>
                        <TableCell data-testid={`text-route-origin-${route.id}`}>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            {route.origin}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-route-destination-${route.id}`}>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-primary" />
                            {route.destination}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-route-distance-${route.id}`}>
                          {route.distance ? (
                            <div className="flex items-center gap-2">
                              <Ruler className="w-4 h-4 text-muted-foreground" />
                              {route.distance} mi
                            </div>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`text-route-duration-${route.id}`}>
                          {route.estimatedDuration ? (
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-muted-foreground" />
                              {formatDuration(route.estimatedDuration)}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs truncate" data-testid={`text-route-notes-${route.id}`}>
                          {route.notes || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(route)}
                              data-testid={`button-edit-route-${route.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingRoute(route)}
                              data-testid={`button-delete-route-${route.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Route Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent data-testid="dialog-add-route">
          <DialogHeader>
            <DialogTitle>Create New Route</DialogTitle>
            <DialogDescription>
              Add a new delivery route with origin, destination, and estimated details.
            </DialogDescription>
          </DialogHeader>
          <Form {...addRouteForm}>
            <form onSubmit={addRouteForm.handleSubmit(handleAddRoute)} className="space-y-4">
              <FormField
                control={addRouteForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Route Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Downtown Express" data-testid="input-route-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addRouteForm.control}
                  name="origin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Origin *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Starting location" data-testid="input-route-origin" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addRouteForm.control}
                  name="destination"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="End location" data-testid="input-route-destination" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addRouteForm.control}
                  name="distance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Distance (miles)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.1"
                          placeholder="e.g., 125.5"
                          data-testid="input-route-distance"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addRouteForm.control}
                  name="estimatedDuration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="e.g., 180"
                          data-testid="input-route-duration"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={addRouteForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Route notes, special instructions, toll roads, etc."
                        rows={3}
                        data-testid="input-route-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                  disabled={addRouteMutation.isPending}
                  data-testid="button-submit-add-route"
                >
                  {addRouteMutation.isPending ? "Creating..." : "Create Route"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Route Dialog */}
      <Dialog open={!!editingRoute} onOpenChange={(open) => !open && setEditingRoute(null)}>
        <DialogContent data-testid="dialog-edit-route">
          <DialogHeader>
            <DialogTitle>Edit Route</DialogTitle>
            <DialogDescription>
              Update route information and details.
            </DialogDescription>
          </DialogHeader>
          <Form {...editRouteForm}>
            <form onSubmit={editRouteForm.handleSubmit(handleEditRoute)} className="space-y-4">
              <FormField
                control={editRouteForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Route Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Downtown Express" data-testid="input-edit-route-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editRouteForm.control}
                  name="origin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Origin *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Starting location" data-testid="input-edit-route-origin" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editRouteForm.control}
                  name="destination"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="End location" data-testid="input-edit-route-destination" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editRouteForm.control}
                  name="distance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Distance (miles)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.1"
                          placeholder="e.g., 125.5"
                          data-testid="input-edit-route-distance"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editRouteForm.control}
                  name="estimatedDuration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="e.g., 180"
                          data-testid="input-edit-route-duration"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={editRouteForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Route notes, special instructions, toll roads, etc."
                        rows={3}
                        data-testid="input-edit-route-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingRoute(null)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={editRouteMutation.isPending}
                  data-testid="button-submit-edit-route"
                >
                  {editRouteMutation.isPending ? "Updating..." : "Update Route"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingRoute} onOpenChange={(open) => !open && setDeletingRoute(null)}>
        <AlertDialogContent data-testid="dialog-delete-route">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Route</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the route "{deletingRoute?.name}"? This route goes from{" "}
              <strong>{deletingRoute?.origin}</strong> to <strong>{deletingRoute?.destination}</strong>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingRoute && deleteRouteMutation.mutate(deletingRoute.id)}
              disabled={deleteRouteMutation.isPending}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRouteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
