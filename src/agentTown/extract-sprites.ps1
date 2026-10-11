param([string]$Sheet, [string]$OutPng, [string]$OutJson, [string]$DebugPng)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Text;

public static class SpriteExtractor {
  static int W, H; static int[] px;
  static int R(int c){return (c>>16)&255;} static int G(int c){return (c>>8)&255;} static int B(int c){return c&255;}
  static int Dist(int a, int b){ return Math.Max(Math.Abs(R(a)-R(b)), Math.Max(Math.Abs(G(a)-G(b)), Math.Abs(B(a)-B(b)))); }
  static int Median(List<int> cs){
    var r = cs.Select(R).OrderBy(v=>v).ToList(); var g = cs.Select(G).OrderBy(v=>v).ToList(); var b = cs.Select(B).OrderBy(v=>v).ToList();
    int m = cs.Count/2; return (r[m]<<16)|(g[m]<<8)|b[m];
  }
  class Comp { public int x0,y0,x1,y1; public int cx { get { return (x0+x1)/2; } } public int cy { get { return (y0+y1)/2; } } }

  // Cut one sprite out of its bbox: flood-fill background from the box edge.
  static Bitmap Cut(int x0,int y0,int x1,int y1,int tol){
    x0=Math.Max(0,x0); y0=Math.Max(0,y0); x1=Math.Min(W-1,x1); y1=Math.Min(H-1,y1);
    int w=x1-x0+1, h=y1-y0+1; var border=new List<int>();
    for(int x=x0;x<=x1;x++){border.Add(px[y0*W+x]);border.Add(px[y1*W+x]);}
    for(int y=y0;y<=y1;y++){border.Add(px[y*W+x0]);border.Add(px[y*W+x1]);}
    int bg=Median(border);
    var clear=new bool[w*h]; var seen=new bool[w*h]; var st=new Stack<int>();
    for(int x=0;x<w;x++){st.Push(x);st.Push((h-1)*w+x);} for(int y=0;y<h;y++){st.Push(y*w);st.Push(y*w+w-1);}
    while(st.Count>0){int k=st.Pop(); if(seen[k])continue; seen[k]=true; int X=k%w,Y=k/w; int c=px[(y0+Y)*W+x0+X];
      if(Dist(c,bg)>tol)continue; clear[k]=true;
      if(X>0)st.Push(k-1); if(X<w-1)st.Push(k+1); if(Y>0)st.Push(k-w); if(Y<h-1)st.Push(k+w);}
    var bmp=new Bitmap(w,h,PixelFormat.Format32bppArgb);
    for(int y=0;y<h;y++)for(int x=0;x<w;x++){ if(clear[y*w+x])continue; int c=px[(y0+y)*W+x0+x]; bmp.SetPixel(x,y,Color.FromArgb(255,R(c),G(c),B(c))); }
    // trim to opaque bounds
    int tx0=w,ty0=h,tx1=-1,ty1=-1; for(int y=0;y<h;y++)for(int x=0;x<w;x++) if(bmp.GetPixel(x,y).A>0){tx0=Math.Min(tx0,x);ty0=Math.Min(ty0,y);tx1=Math.Max(tx1,x);ty1=Math.Max(ty1,y);}
    if(tx1<0) return bmp;
    return bmp.Clone(new Rectangle(tx0,ty0,tx1-tx0+1,ty1-ty0+1),PixelFormat.Format32bppArgb);
  }

  public static string Run(string sheet, string outPng, string debugPng){
    var src=new Bitmap(sheet); W=src.Width; H=src.Height; px=new int[W*H];
    var data=src.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
    System.Runtime.InteropServices.Marshal.Copy(data.Scan0,px,0,W*H); src.UnlockBits(data);
    for(int i=0;i<px.Length;i++) px[i]&=0xFFFFFF;

    string[] names={"CYBER ENGR","DATA","SECURITY","RESEARCH","AI UNIT","COMMAND","HACKER","DATA SERVER","AUTOMATION","DEV LAB","SERVER VAULT","OPS"};
    int[] colX={142,640,1135}; int[] colW={365,362,367}; int[] rowY={106,316,523,726}; int rowH=128;
    int[] portX={38,538,1033}; int[] portY={108,318,525,728};
    const int CW=48, CH=64, PW=104, PH=144; // atlas cells
    var frames=new List<Tuple<int,string,int,int,Bitmap>>(); // char, section anim, row, col, bmp
    var portraits=new Bitmap[12];
    var dbg=new Bitmap(src); var dg=Graphics.FromImage(dbg);
    var sb=new StringBuilder();
    for(int ci=0;ci<12;ci++){
      int x0=colX[ci%3], y0=rowY[ci/3], w=colW[ci%3], h=rowH;
      var all=new List<int>(); for(int y=y0;y<y0+h;y+=2)for(int x=x0;x<x0+w;x+=2) all.Add(px[y*W+x]);
      int bg=Median(all);
      // separators: columns dominated by bright thin lines
      var sepCols=new List<int>();
      for(int x=x0;x<x0+w;x++){int n=0; for(int y=y0;y<y0+h;y++){int c=px[y*W+x]; if(Math.Max(R(c),Math.Max(G(c),B(c)))-Math.Max(R(bg),Math.Max(G(bg),B(bg)))>25) n++;} if(n>h*0.8) sepCols.Add(x);}
      var seps=new List<int>(); foreach(var x in sepCols) if(seps.Count==0||x-seps[seps.Count-1]>6) seps.Add(x);
      // foreground mask, dilated
      var mask=new bool[w*h];
      for(int y=0;y<h;y++)for(int x=0;x<w;x++){ if(sepCols.Contains(x0+x))continue; if(Dist(px[(y0+y)*W+x0+x],bg)>34) mask[y*w+x]=true; }
      var dil=new bool[w*h];
      for(int y=0;y<h;y++)for(int x=0;x<w;x++) if(mask[y*w+x]) for(int dy=-2;dy<=2;dy++)for(int dx=-1;dx<=1;dx++){int X=x+dx,Y=y+dy; if(X>=0&&Y>=0&&X<w&&Y<h) dil[Y*w+X]=true;}
      var lab=new int[w*h]; var comps=new List<Comp>();
      for(int s=0;s<w*h;s++){ if(!dil[s]||lab[s]!=0)continue; var c=new Comp{x0=w,y0=h,x1=-1,y1=-1}; var st=new Stack<int>(); st.Push(s); lab[s]=comps.Count+1;
        while(st.Count>0){int k=st.Pop(); int X=k%w,Y=k/w; c.x0=Math.Min(c.x0,X);c.y0=Math.Min(c.y0,Y);c.x1=Math.Max(c.x1,X);c.y1=Math.Max(c.y1,Y);
          for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int X2=X+dx,Y2=Y+dy; if(X2<0||Y2<0||X2>=w||Y2>=h)continue; int k2=Y2*w+X2; if(dil[k2]&&lab[k2]==0){lab[k2]=comps.Count+1; st.Push(k2);}}}
        comps.Add(c); }
      var good=comps.Where(c=>{int cw=c.x1-c.x0+1, chh=c.y1-c.y0+1; return chh>=28&&chh<=72&&cw>=12&&cw<=60;}).ToList();
      int midY=h/2;
      sb.AppendFormat("{0}: bg={1:X6} seps=[{2}] comps={3}\n", names[ci], bg, string.Join(",",seps.Select(v=>v-x0)), good.Count);
      foreach(var c in good){
        int ax=x0+c.cx; int section=seps.Count(sx=>sx<ax); int row=c.cy<midY?0:1;
        var bmp=Cut(x0+c.x0-2,y0+c.y0-2,x0+c.x1+2,y0+c.y1+2,30);
        frames.Add(Tuple.Create(ci, "s"+section, row, x0+c.cx, bmp));
        dg.DrawRectangle(Pens.Red,x0+c.x0,y0+c.y0,c.x1-c.x0,c.y1-c.y0);
      }
      foreach(var sx in seps) dg.DrawLine(Pens.Yellow,sx,y0,sx,y0+h);
      portraits[ci]=Cut(portX[ci%3]+6,portY[ci/3]+8,portX[ci%3]+94,portY[ci/3]+136,40);
    }
    dbg.Save(debugPng);
    // atlas: frames in rows of 24 cells, portraits in a strip below
    int perRow=24; int frameRows=(frames.Count+perRow-1)/perRow;
    var atlas=new Bitmap(Math.Max(perRow*CW, 12*PW), frameRows*CH+PH, PixelFormat.Format32bppArgb); var ag=Graphics.FromImage(atlas);
    ag.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
    var json=new StringBuilder("{\"cell\":{\"w\":"+CW+",\"h\":"+CH+"},\"portrait\":{\"w\":"+PW+",\"h\":"+PH+",\"y\":"+(frameRows*CH)+"},\"characters\":{");
    for(int ci=0;ci<12;ci++){
      var mine=frames.Where(f=>f.Item1==ci).OrderBy(f=>f.Item2).ThenBy(f=>f.Item3).ThenBy(f=>f.Item4).ToList();
      json.Append((ci>0?",":"")+"\""+names[ci]+"\":{\"portrait\":"+ci+",\"frames\":[");
      bool first=true;
      foreach(var f in mine){
        int idx=frames.IndexOf(f); int cx=(idx%perRow)*CW, cy=(idx/perRow)*CH; var b=f.Item5;
        int dx=cx+(CW-b.Width)/2, dy=cy+CH-1-b.Height; ag.DrawImage(b,dx,dy,b.Width,b.Height);
        json.Append((first?"":",")+"{\"i\":"+idx+",\"sec\":\""+f.Item2+"\",\"row\":"+f.Item3+",\"x\":"+f.Item4+",\"w\":"+b.Width+",\"h\":"+b.Height+"}"); first=false;
      }
      json.Append("]}");
      var p=portraits[ci]; ag.DrawImage(p, ci*PW+(PW-p.Width)/2, frameRows*CH+PH-1-p.Height, p.Width, p.Height);
    }
    json.Append("}}");
    atlas.Save(outPng, ImageFormat.Png);
    return sb.ToString()+"\n@@JSON@@"+json.ToString();
  }
}
"@
$res = [SpriteExtractor]::Run($Sheet, $OutPng, $DebugPng)
$parts = $res -split '@@JSON@@'
$parts[0]
[System.IO.File]::WriteAllText($OutJson, $parts[1])
