import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mockTuitions, mockStudents } from "@/data/mockData";
import { Tuition, PaymentStatus } from "@/types";
import { Calendar, DollarSign, User, CheckCircle } from "lucide-react";

const statusConfig = {
  pending: {
    title: "Pendentes",
    color: "bg-pending-light border-pending",
    badgeVariant: "secondary" as const,
  },
  paid: {
    title: "Pagos",
    color: "bg-paid-light border-paid",
    badgeVariant: "default" as const,
  },
  overdue: {
    title: "Atrasados",
    color: "bg-overdue-light border-overdue",
    badgeVariant: "destructive" as const,
  },
};

interface TuitionCardProps {
  tuition: Tuition;
  onStatusChange: (id: string, status: PaymentStatus) => void;
}

function TuitionCard({ tuition, onStatusChange }: TuitionCardProps) {
  const student = mockStudents.find(s => s.id === tuition.studentId);
  const isOverdue = new Date(tuition.dueDate) < new Date() && tuition.status === "pending";

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (date: string) => {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(date));
  };

  return (
    <Card className="mb-3 hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{student?.name}</span>
          </div>
          <Badge variant={statusConfig[tuition.status].badgeVariant}>
            {tuition.status === "pending" && isOverdue ? "Atrasado" : statusConfig[tuition.status].title.slice(0, -1)}
          </Badge>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-lg">{formatCurrency(tuition.amount)}</span>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Venc: {formatDate(tuition.dueDate)}</span>
          </div>

          <p className="text-sm text-muted-foreground">{tuition.description}</p>

          {tuition.paidDate && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle className="h-4 w-4" />
              <span>Pago em {formatDate(tuition.paidDate)}</span>
            </div>
          )}
        </div>

        {tuition.status === "pending" && (
          <Button
            size="sm"
            className="w-full"
            onClick={() => onStatusChange(tuition.id, "paid")}
          >
            Marcar como Pago
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function FinancialKanban() {
  const [tuitions, setTuitions] = useState<Tuition[]>(mockTuitions);

  const handleStatusChange = (id: string, newStatus: PaymentStatus) => {
    setTuitions(prev => prev.map(tuition => {
      if (tuition.id === id) {
        return {
          ...tuition,
          status: newStatus,
          paidDate: newStatus === "paid" ? new Date().toISOString() : undefined,
          paymentMethod: newStatus === "paid" ? "Sistema" : undefined,
        };
      }
      return tuition;
    }));
  };

  // Separate tuitions by status, but check for overdue ones
  const categorizedTuitions = {
    pending: tuitions.filter(t => {
      const isOverdue = new Date(t.dueDate) < new Date();
      return t.status === "pending" && !isOverdue;
    }),
    overdue: tuitions.filter(t => {
      const isOverdue = new Date(t.dueDate) < new Date();
      return t.status === "pending" && isOverdue || t.status === "overdue";
    }),
    paid: tuitions.filter(t => t.status === "paid"),
  };

  const getTotalAmount = (tuitionList: Tuition[]) => {
    return tuitionList.reduce((sum, t) => sum + t.amount, 0);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="space-y-4">
        <Card className={statusConfig.pending.color}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span>Pendentes</span>
              <Badge variant="outline">
                {categorizedTuitions.pending.length}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Total: {formatCurrency(getTotalAmount(categorizedTuitions.pending))}
            </p>
          </CardHeader>
        </Card>
        
        <div className="space-y-3">
          {categorizedTuitions.pending.map(tuition => (
            <TuitionCard
              key={tuition.id}
              tuition={tuition}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Card className={statusConfig.overdue.color}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span>Atrasados</span>
              <Badge variant="destructive">
                {categorizedTuitions.overdue.length}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Total: {formatCurrency(getTotalAmount(categorizedTuitions.overdue))}
            </p>
          </CardHeader>
        </Card>
        
        <div className="space-y-3">
          {categorizedTuitions.overdue.map(tuition => (
            <TuitionCard
              key={tuition.id}
              tuition={tuition}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Card className={statusConfig.paid.color}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span>Pagos</span>
              <Badge variant="default">
                {categorizedTuitions.paid.length}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Total: {formatCurrency(getTotalAmount(categorizedTuitions.paid))}
            </p>
          </CardHeader>
        </Card>
        
        <div className="space-y-3">
          {categorizedTuitions.paid.map(tuition => (
            <TuitionCard
              key={tuition.id}
              tuition={tuition}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}