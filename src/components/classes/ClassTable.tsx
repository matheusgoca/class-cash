import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Edit2, Trash2, Search, Users } from 'lucide-react';

interface Class {
  id: string;
  name: string;
  description?: string;
  teacher_id?: string;
  max_capacity: number;
  tuition_per_student?: number;
  color: string;
  teachers?: { name: string; subject: string };
  student_count?: number;
}

interface ClassTableProps {
  classes: Class[];
  teachers: any[];
  onEdit: (classData: Class) => void;
  onDelete: (classId: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
}

export const ClassTable: React.FC<ClassTableProps> = ({
  classes,
  teachers,
  onEdit,
  onDelete,
  searchTerm,
  onSearchChange,
}) => {
  const getTeacherName = (cls: Class) => {
    if (cls.teachers?.name) {
      return `${cls.teachers.name} - ${cls.teachers.subject}`;
    }
    const teacher = teachers.find(t => t.id === cls.teacher_id);
    return teacher ? `${teacher.name} - ${teacher.subject}` : 'Sem professor';
  };

  const getStatusColor = (studentCount: number, maxCapacity: number) => {
    const percentage = studentCount / maxCapacity;
    if (percentage >= 0.9) return 'bg-red-100 text-red-800'; // Quase lotada
    if (percentage >= 0.7) return 'bg-yellow-100 text-yellow-800'; // Moderada
    return 'bg-green-100 text-green-800'; // Disponível
  };

  const getStatusText = (studentCount: number, maxCapacity: number) => {
    const percentage = studentCount / maxCapacity;
    if (percentage >= 0.9) return 'Quase Lotada';
    if (percentage >= 0.7) return 'Moderada';
    return 'Disponível';
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Buscar por nome da turma..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Turma</TableHead>
              <TableHead>Professor</TableHead>
              <TableHead>Alunos</TableHead>
              <TableHead>Mensalidade</TableHead>
              <TableHead>Receita Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhuma turma encontrada
                </TableCell>
              </TableRow>
            ) : (
              classes.map((cls) => {
                const studentCount = cls.student_count || 0;
                return (
                  <TableRow key={cls.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: cls.color }}
                        />
                        <span className="font-medium">{cls.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getTeacherName(cls)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {studentCount}/{cls.max_capacity}
                      </div>
                    </TableCell>
                    <TableCell>
                      {cls.tuition_per_student ? 
                        new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(cls.tuition_per_student)
                        : '-'
                      }
                    </TableCell>
                    <TableCell>
                      {cls.tuition_per_student ? 
                        new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(cls.tuition_per_student * studentCount)
                        : '-'
                      }
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(studentCount, cls.max_capacity)}>
                        {getStatusText(studentCount, cls.max_capacity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(cls)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir a turma "{cls.name}"? Esta ação não pode ser desfeita.
                                {studentCount > 0 && " Não é possível excluir uma turma com alunos matriculados."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => onDelete(cls.id)}
                                disabled={studentCount > 0}
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};