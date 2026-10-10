// Run after unpacking the @uiw 4.25.11 sources into dist/theme-import.
const fs=require('fs'),vm=require('vm'),esbuild=require('esbuild');
const root=process.argv[2] || 'D:/GoogleDownload/terax-ai-main';
const tags=new Proxy({}, {get:(_,k)=> ['special','constant','function','definition','local','standard'].includes(k) ? value=>k+'('+value+')' : String(k)});
function load(source,loader='js') {
 const code=esbuild.transformSync(source,{loader,format:'cjs'}).code, module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(name==='@lezer/highlight')return {tags};if(name==='@uiw/codemirror-themes')return {createTheme:options=>options};if(name==='@babel/runtime/helpers/extends')return Object.assign;throw Error(name);}});
 return module.exports;
}
const localIds={kanagawa:'kanagawa',kanagawaLotus:'kanagawa-lotus',kanagawaDragon:'kanagawa-dragon',everforestDark:'everforest',everforestLight:'everforest-light',dracula:'dracula',solarizedDark:'solarized-dark',solarizedLight:'solarized-light',catppuccinMocha:'catppuccin-mocha',catppuccinLatte:'catppuccin-latte',rosePine:'rose-pine',rosePineDawn:'rose-pine-dawn'};
const themes={},local=load(fs.readFileSync(root+'/src/modules/editor/lib/cmThemes.ts','utf8'),'ts');
for(const [name,id] of Object.entries(localIds))themes[id]=local[name];
const packages={atomone:{atomone:'atomone'},aura:{aura:'aura'},copilot:{copilot:'copilot'},github:{githubDark:'github-dark',githubLight:'github-light'},'gruvbox-dark':{gruvboxDark:'gruvbox-dark'},nord:{nord:'nord'},'tokyo-night':{tokyoNight:'tokyo-night'},xcode:{xcodeDark:'xcode-dark',xcodeLight:'xcode-light'}};
for(const [pkg,entries] of Object.entries(packages)){const exports=load(esbuild.buildSync({entryPoints:['dist/theme-import/'+pkg+'/package/esm/index.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['@lezer/highlight','@uiw/codemirror-themes','@babel/runtime/*']}).outputFiles[0].text);for(const [name,id] of Object.entries(entries)){if(!exports[name]?.settings)throw Error('Missing '+name);themes[id]=exports[name];}}
const tokenMap={comment:'comment',lineComment:'comment',blockComment:'comment',docComment:'comment',keyword:'keyword',modifier:'keyword',controlKeyword:'keyword',operatorKeyword:'keyword',moduleKeyword:'keyword',self:'keyword',string:'string',regexp:'regexp',character:'string',number:'number',bool:'constant',null:'constant',atom:'constant',variableName:'variable',name:'identifier',propertyName:'variable',typeName:'type',className:'type',namespace:'type',operator:'operator',punctuation:'delimiter',separator:'delimiter',bracket:'delimiter',tagName:'tag',angleBracket:'delimiter',attributeName:'attribute.name',attributeValue:'attribute.value',heading:'keyword',link:'string',url:'string',invalid:'invalid',meta:'metatag'};
const names={'kanagawa':'Kanagawa Wave','kanagawa-lotus':'Kanagawa Lotus','kanagawa-dragon':'Kanagawa Dragon','catppuccin-mocha':'Catppuccin Mocha','catppuccin-latte':'Catppuccin Latte','rose-pine':'Rosé Pine','rose-pine-dawn':'Rosé Pine Dawn','everforest':'Everforest Dark','everforest-light':'Everforest Light','dracula':'Dracula','solarized-dark':'Solarized Dark','solarized-light':'Solarized Light','tokyo-night':'Tokyo Night','nord':'Nord','gruvbox-dark':'Gruvbox Dark','atomone':'Atom One','aura':'Aura','copilot':'Copilot','github-dark':'GitHub Dark','github-light':'GitHub Light','xcode-dark':'Xcode Dark','xcode-light':'Xcode Light'};
const result=Object.entries(themes).map(([id,t])=>({id,name:names[id],mode:t.theme,settings:t.settings,rules:t.styles.flatMap(style=>{
 const tokens=[...new Set([style.tag].flat(Infinity).map(tag=>tokenMap[tag] || (String(tag).startsWith('function(')?'function':String(tag).startsWith('constant(')?'constant':String(tag).includes('string')?'string':null)).filter(Boolean))];
 return tokens.map(token=>({token,...(style.color?{foreground:style.color.replace('#','')}:{}),...(style.fontStyle || style.fontWeight==='bold'?{fontStyle:[style.fontStyle,style.fontWeight==='bold'?'bold':''].filter(Boolean).join(' ')}:{})}));
})}));
fs.writeFileSync('public/themes/editor-palettes.js','// Adapted from Terax AI and @uiw/codemirror-theme-* 4.25.11. See THIRD_PARTY_NOTICES.md.\nwindow.FB_EDITOR_THEMES = '+JSON.stringify(result)+';\n');
console.log('Imported editor palettes: '+result.length);
