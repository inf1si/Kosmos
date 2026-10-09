import MarkdownIt from 'markdown-it';

// Raw HTML stays text; images, headings and tables are off so a bio cannot fetch outside resources or outrank the page title.
const markdown=new MarkdownIt({html:false,linkify:true,breaks:true}).disable(['image','heading','lheading','table']);

const defaultLinkOpen=markdown.renderer.rules.link_open||((tokens,index,options,_env,self)=>self.renderToken(tokens,index,options));

markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{
  tokens[index].attrSet('rel','nofollow noopener noreferrer');

  return defaultLinkOpen(tokens,index,options,env,self);
};

export function renderProfileMarkdown(bio:string){return markdown.render(bio);}
