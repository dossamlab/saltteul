package kr.saltteul.app.widget;

/** 4x4: dashboard header plus today's todos, routines, kidsnote schedule and shopping list. */
public class TabletWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_TABLET;
    }
}
