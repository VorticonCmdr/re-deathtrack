// Exports decompiled C, disassembly and a function index of the current program to .local/re/export.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportAll extends GhidraScript { public void run() throws Exception {
 File dir=new File("/Users/valentin.pletzer/Downloads/dosgames/Deathtrack/.local/re/export"); dir.mkdirs();
 DecompInterface d=new DecompInterface(); d.openProgram(currentProgram);
 PrintWriter c=new PrintWriter(new FileWriter(new File(dir,"decomp.c")));
 PrintWriter a=new PrintWriter(new FileWriter(new File(dir,"disasm.asm")));
 PrintWriter idx=new PrintWriter(new FileWriter(new File(dir,"functions.tsv")));
 int n=0;
 for (Function f: currentProgram.getFunctionManager().getFunctions(true)) {
  n++; idx.println(f.getEntryPoint()+"\t"+f.getName()+"\t"+f.getBody().getNumAddresses()+"\t"+f.getCallingConventionName());
  DecompileResults r=d.decompileFunction(f,60,monitor);
  c.println("//==== "+f.getEntryPoint()+" "+f.getName());
  c.println(r.decompileCompleted()?r.getDecompiledFunction().getC():"// DECOMPILE FAILED "+r.getErrorMessage());
  a.println(";==== "+f.getEntryPoint()+" "+f.getName());
  for (Instruction i: currentProgram.getListing().getInstructions(f.getBody(),true)) a.println(i.getAddress()+"  "+i);
 }
 c.close(); a.close(); idx.close(); println("exported "+n);
}}
