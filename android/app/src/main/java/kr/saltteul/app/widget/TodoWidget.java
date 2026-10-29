package kr.saltteul.app.widget;

/** 2x2: today's open todos and routines (up to 4 rows) with the number left. */
public class TodoWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_TODO;
    }
}
